import { pendingDnsChallenges } from './dns-store.js';
import { logger } from '../utils/logger.js';

export async function challengeRemoveFn(authz: any, challenge: any, keyAuthorization: string) {
  if (challenge.type === 'dns-01') {
    logger.info(`[DNS-01] Cleaning up challenge for ${authz.identifier.value}`);
    pendingDnsChallenges.delete(challenge.token);
  }
}
