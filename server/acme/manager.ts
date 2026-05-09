import * as acme from 'acme-client';
import { certStorage, dataStorage } from './storage.js';
import { challengeRemoveFn } from './challenges.js';
import { activeJobs, pendingDnsChallenges } from './dns-store.js';
import { logger } from '../utils/logger.js';

interface CertOrderParams {
  domains: string[]; // First domain will be the common name, rest will be SANs
  maintainerEmail: string;
  jobId: string;
  userId: string;
  useProduction?: boolean;
}

export async function requestCertificateBg({ domains, maintainerEmail, jobId, userId, useProduction = false }: CertOrderParams) {
  const job = activeJobs.get(jobId);
  if (!job) return;

  const envPrefix = useProduction ? 'prod' : 'staging';
  const ACME_DIRECTORY_URL = useProduction 
    ? acme.directory.letsencrypt.production 
    : acme.directory.letsencrypt.staging;

  try {
    let accountKey: Buffer;
    const keyFile = `account-${envPrefix}.key`;
    const urlFile = `account-${envPrefix}.url`;
    
    // 1. Get or generate account key
    const accountKeyExists = await dataStorage.fileExists(keyFile);
    if (accountKeyExists) {
      accountKey = await dataStorage.readFile(keyFile);
    } else {
      accountKey = await acme.crypto.createPrivateKey();
      await dataStorage.saveFile(keyFile, accountKey);
    }

    // 3. Register or get account
    const accountUrlExists = await dataStorage.fileExists(urlFile);
    let accountUrl: string | undefined = undefined;
    if (accountUrlExists) {
        accountUrl = (await dataStorage.readFile(urlFile)).toString();
    }

    // 2. Initialize ACME client
    const client = new acme.Client({
      directoryUrl: ACME_DIRECTORY_URL,
      accountKey: accountKey,
      accountUrl: accountUrl
    });
    
    await client.createAccount({
      termsOfServiceAgreed: true,
      contact: [`mailto:${maintainerEmail}`]
    });
    
    if (!accountUrlExists) {
         await dataStorage.saveFile(urlFile, client.getAccountUrl());
    }

    // 4. Create CSR (Certificate Signing Request)
    const [certKey, certCsr] = await acme.crypto.createCsr({
      commonName: domains[0],
      altNames: domains.length > 1 ? domains.slice(1) : undefined
    });

    // 5. Order the certificate (Auto-handles the challenges via our provided callbacks)
    job.status = 'waiting_dns';
    const cert = await client.auto({
      csr: certCsr,
      email: maintainerEmail,
      termsOfServiceAgreed: true,
      challengePriority: ['dns-01'],
      challengeCreateFn: async (authz, challenge, keyAuth) => {
        const domain = authz.identifier.value;
        const txtRecordName = `_acme-challenge.${domain}`;
        
        await new Promise<void>((resolve) => {
          pendingDnsChallenges.set(challenge.token, {
            token: challenge.token,
            domain,
            recordName: txtRecordName,
            recordValue: keyAuth,
            userId,
            resolve
          });
        });
      },
      challengeRemoveFn
    });

    job.status = 'processing';

    // 6. Save keys and certs to storage with user prefix
    const primaryDomain = domains[0];
    const prefix = `user_${userId}_`;
    
    const certFilename = `${prefix}${primaryDomain}.cert`;
    const keyFilename = `${prefix}${primaryDomain}.key`;
    
    await certStorage.saveFile(keyFilename, certKey);
    await certStorage.saveFile(certFilename, cert);
    
    // Save metadata
    await dataStorage.saveFile(`${prefix}${primaryDomain}.meta.json`, JSON.stringify({
      domains,
      maintainerEmail,
      userId,
      environment: useProduction ? 'production' : 'staging',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
    }, null, 2));

    job.status = 'completed';

  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ err, jobId, domains }, 'Failed to request certificate');
    job.status = 'error';
    job.error = err.message;
  }
}

