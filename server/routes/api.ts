import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { register, login, logout, me, authenticateToken, AuthRequest } from "../auth.js";
import { activeJobs, pendingDnsChallenges } from "../acme/dns-store.js";
import { dataStorage, certStorage } from "../acme/storage.js";
import { requestCertificateBg } from "../acme/manager.js";
import { checkAndRenewCertificates } from "../cron/renew.js";

const apiRouter = Router();

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 1000, // Increased to support frontend polling
  message: { error: "Too many requests, please try again later." }
});

const certRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  message: { error: "Certificate request limit reached (5 per hour). Please try again later." }
});

const authSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters")
});

const certRequestSchema = z.object({
  domains: z.array(z.string().min(1, "Domain cannot be empty")).min(1, "At least one domain is required"),
  maintainerEmail: z.string().email("Invalid maintainer email"),
  useProduction: z.boolean().optional()
});

const validateBody = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: (error as z.ZodError).issues.map((e) => e.message).join(', ') });
      } else {
        res.status(400).json({ error: "Invalid request data" });
      }
    }
  };
};

// Apply global rate limiter
apiRouter.use(globalLimiter);

// ========== Auth APIs ==========

apiRouter.post("/auth/register", validateBody(authSchema), register);
apiRouter.post("/auth/login", validateBody(authSchema), login);
apiRouter.post("/auth/logout", logout);
apiRouter.get("/auth/me", authenticateToken, me);

// ========== Internal APIs (Protected) ==========

apiRouter.get("/jobs", authenticateToken, (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const jobs = Array.from(activeJobs.values()).filter(j => j.userId === userId);
  res.json({ jobs });
});

apiRouter.get("/challenges/dns", authenticateToken, (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const challenges = Array.from(pendingDnsChallenges.values())
    .filter(c => c.userId === userId)
    .map(c => ({
      token: c.token,
      domain: c.domain,
      recordName: c.recordName,
      recordValue: c.recordValue
    }));
  res.json({ challenges });
});

apiRouter.post("/challenges/dns/:token/verify", authenticateToken, async (req: AuthRequest, res) => {
  const { token } = req.params;
  const userId = req.user!.id;
  const challenge = pendingDnsChallenges.get(token);
  
  if (!challenge || challenge.userId !== userId) {
    return res.status(404).json({ error: "Challenge not found or already verified" });
  }
  
  try {
    const { Resolver } = await import('dns/promises');
    const resolver = new Resolver();
    // Use public resolvers to avoid local negative caching
    resolver.setServers(['8.8.8.8', '1.1.1.1']);
    
    const records = await resolver.resolveTxt(challenge.recordName);
    // resolveTxt returns an array of arrays of strings
    const isVerified = records.some(recordArray => recordArray.join('') === challenge.recordValue);
    
    if (!isVerified) {
      return res.status(400).json({ error: "DNS TXT record found, but the value does not match. Please ensure you copied it exactly." });
    }
  } catch (err: unknown) {
    if (err instanceof Error) {
      const dnsErr = err as any;
      if (dnsErr.code === 'ENODATA' || dnsErr.code === 'ENOTFOUND') {
        return res.status(400).json({ error: "DNS TXT record not found yet. Please wait a bit longer for propagation." });
      }
      return res.status(400).json({ error: `DNS resolution error: ${err.message}` });
    }
    return res.status(400).json({ error: "Unknown DNS resolution error" });
  }

  // Unblock the process
  challenge.resolve();
  res.json({ success: true, message: "Verification step continued" });
});

apiRouter.post("/certs/request", authenticateToken, certRequestLimiter, validateBody(certRequestSchema), async (req: AuthRequest, res) => {
  try {
    const { domains, maintainerEmail, useProduction } = req.body;
    const userId = req.user!.id;

    const jobId = crypto.randomUUID();
    activeJobs.set(jobId, { 
      id: jobId, 
      domains, 
      status: 'processing',
      userId
    });

    // Run background task
    requestCertificateBg({ domains, maintainerEmail, jobId, userId, useProduction: !!useProduction });
    
    res.json({ jobId, message: "Certificate request started in background" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    res.status(500).json({ error: message });
  }
});

apiRouter.get("/certs", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const prefix = `user_${userId}_`;

    const files = await dataStorage.listFiles();
    const metaFiles = files.filter(f => f.startsWith(prefix) && f.endsWith('.meta.json'));
    
    const certs = await Promise.all(metaFiles.map(async (f) => {
      const content = await dataStorage.readFile(f);
      const meta = JSON.parse(content.toString());
      // Attempt to fetch actual certificate to parse validTo from PEM
      try {
         const primaryDomain = meta.domains[0];
         const certFilename = `${prefix}${primaryDomain}.cert`;
         if (await certStorage.fileExists(certFilename)) {
           const certFile = await certStorage.readFile(certFilename);
           const { X509Certificate } = await import('crypto');
           const x509 = new X509Certificate(certFile.toString());
           meta.expiresAt = x509.validTo; // Real expiry
           meta.issuer = x509.issuer.split('\n').join(', ');
         }
      } catch (e) {
         // fallback to meta info
      }
      return meta;
    }));

    res.json({ certs });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    res.status(500).json({ error: message });
  }
});

apiRouter.get("/certs/download/:domain/:type", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { domain, type } = req.params;
    const userId = req.user!.id;
    const prefix = `user_${userId}_`;

    if (type !== 'cert' && type !== 'key' && type !== 'chain' && type !== 'fullchain') {
      return res.status(400).send("Invalid file type requested.");
    }
    
    const filename = `${prefix}${domain}.${type}`;
    let content: Buffer;

    if (!(await certStorage.fileExists(filename))) {
      // Backwards compatibility: if chain/fullchain/cert is missing, try to derive from existing .cert file
      // Older versions saved the full chain in the .cert file.
      const certFilename = `${prefix}${domain}.cert`;
      if (await certStorage.fileExists(certFilename)) {
        const fullCertContent = (await certStorage.readFile(certFilename)).toString();
        const certs = fullCertContent.split('-----END CERTIFICATE-----')
          .filter(c => c.trim().length > 0)
          .map(c => c + '-----END CERTIFICATE-----');

        if (type === 'cert') {
          content = Buffer.from(certs[0] || "");
        } else if (type === 'chain') {
          content = Buffer.from(certs.slice(1).join('\n').trim());
        } else if (type === 'fullchain') {
          content = Buffer.from(fullCertContent);
        } else {
           // Key must exist as a file
           return res.status(404).send("File not found.");
        }
        
        if (content.length === 0) {
          return res.status(404).send("File component not found in certificate.");
        }
      } else {
        return res.status(404).send("File not found.");
      }
    } else {
      content = await certStorage.readFile(filename);
    }

    res.setHeader('Content-Disposition', `attachment; filename="${domain}.${type}"`);
    res.setHeader('Content-Type', 'application/x-pem-file');
    res.send(content);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    res.status(500).send(message);
  }
});

apiRouter.get("/certs/export/:domain", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { domain } = req.params;
    const userId = req.user!.id;
    const prefix = `user_${userId}_`;

    let privateKey = "";
    let certificate = "";
    let chain = "";

    // Load Private Key
    try {
      privateKey = (await certStorage.readFile(`${prefix}${domain}.key`)).toString();
    } catch (e) {
      return res.status(404).json({ error: "Private key not found." });
    }

    // Load Certificate and Chain (with backwards compatibility)
    const certFilename = `${prefix}${domain}.cert`;
    const chainFilename = `${prefix}${domain}.chain`;

    if (await certStorage.fileExists(chainFilename)) {
      certificate = (await certStorage.readFile(certFilename)).toString();
      chain = (await certStorage.readFile(chainFilename)).toString();
    } else if (await certStorage.fileExists(certFilename)) {
      // Reconstruct from full cert
      const fullCertContent = (await certStorage.readFile(certFilename)).toString();
      const certs = fullCertContent.split('-----END CERTIFICATE-----')
        .filter(c => c.trim().length > 0)
        .map(c => c + '-----END CERTIFICATE-----');
      
      certificate = certs[0] || "";
      chain = certs.slice(1).join('\n').trim();
    } else {
      return res.status(404).json({ error: "Certificate files not found." });
    }

    res.json({ 
      privateKey, 
      certificate, 
      chain 
    });
  } catch (error: unknown) {
    res.status(500).json({ error: "Internal server error while exporting certificate." });
  }
});

apiRouter.post("/certs/force-renew", authenticateToken, async (req: AuthRequest, res) => {
   try {
      await checkAndRenewCertificates();
      res.json({ message: "Renewal check completed" });
   } catch(error: unknown) {
      const message = error instanceof Error ? error.message : "Internal Server Error";
      res.status(500).json({ error: message });
   }
});

export default apiRouter;
