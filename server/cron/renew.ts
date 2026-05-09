import cron from 'node-cron';
import { certStorage, dataStorage } from '../acme/storage.js';
import { requestCertificateBg } from '../acme/manager.js';
import { activeJobs } from '../acme/dns-store.js';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';

/**
 * Parses the PEM certificate to find its "Not After" date.
 */
function getCertExpiry(certPem: string): Date {
  const x509 = new crypto.X509Certificate(certPem);
  return new Date(x509.validTo);
}

/**
 * Scans all stored certificates and triggers renewal if expiring within 30 days.
 */
export async function checkAndRenewCertificates() {
  logger.info('[Auto-Renew] Starting certificate renewal check...');
  try {
    const files = await dataStorage.listFiles();
    const metaFiles = files.filter(f => f.endsWith('.meta.json'));

    for (const metaFile of metaFiles) {
      try {
        const metaContent = (await dataStorage.readFile(metaFile)).toString();
        const meta = JSON.parse(metaContent);
        
        if (!meta.domains || !Array.isArray(meta.domains) || meta.domains.length === 0) {
          logger.warn({ metaFile }, '[Auto-Renew] Invalid meta file (missing domains), skipping...');
          continue;
        }

        const primaryDomain = meta.domains[0];
        // The cert filename logic from manager.ts prepends user prefix:
        // const prefix = `user_${userId}_`;
        // const certFilename = `${prefix}${primaryDomain}.cert`;
        // Ah, looking at renew.ts line 30, it previously assumed `${primaryDomain}.cert` directly.
        // Wait, earlier I saw manager.ts uses prefix for certs!
        // Let's fix this bug while adding resiliency.
        const certFilename = meta.userId ? `user_${meta.userId}_${primaryDomain}.cert` : `${primaryDomain}.cert`;
        
        if (!(await certStorage.fileExists(certFilename))) {
          logger.warn({ domain: primaryDomain, certFilename }, '[Auto-Renew] Cert missing, skipping...');
          continue;
        }

        const certPem = (await certStorage.readFile(certFilename)).toString();
        const expiryDate = getCertExpiry(certPem);
        
        const now = new Date();
        const diffMs = expiryDate.getTime() - now.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);

        logger.info({ domain: primaryDomain, expires: expiryDate.toISOString(), daysLeft: Math.round(diffDays) }, '[Auto-Renew] Expiry check');

        // Check if expiry is <= 30 days
        if (diffDays <= 30) {
          logger.info({ domain: primaryDomain }, '[Auto-Renew] Triggering renewal');
          const jobId = crypto.randomUUID();
          activeJobs.set(jobId, { id: jobId, domains: meta.domains, status: 'processing', userId: meta.userId });
          
          // Fire and forget; user will need to check UI to complete DNS challenges
          // OR this could be integrated via an actual DNS API provider for true automation
          requestCertificateBg({
            domains: meta.domains,
            maintainerEmail: meta.maintainerEmail,
            jobId,
            userId: meta.userId,
            useProduction: meta.environment === 'production'
          });
          logger.info({ domain: primaryDomain, jobId }, '[Auto-Renew] Successfully queued renewal');
        }
      } catch (err: unknown) {
         const error = err instanceof Error ? err : new Error(String(err));
         logger.error({ error, metaFile }, '[Auto-Renew] Error processing meta file');
      }
    }
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ err }, '[Auto-Renew] Failed to perform renewal check calculation');
  }
}

// Schedule cron job to run every day at Midnight (0 0 * * *)
export function setupCron() {
  logger.info('[Cron] Initializing auto-renewal cronjob (0 0 * * *)');
  cron.schedule('0 0 * * *', async () => {
    await checkAndRenewCertificates();
  });
}

