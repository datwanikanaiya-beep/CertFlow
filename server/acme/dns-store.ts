export interface DnsChallenge {
  token: string;
  domain: string;
  recordName: string;
  recordValue: string;
  userId: string;
  resolve: () => void;
}

export const pendingDnsChallenges = new Map<string, DnsChallenge>();

export interface CertJob {
  id: string;
  domains: string[];
  status: 'processing' | 'waiting_dns' | 'completed' | 'error';
  userId: string;
  error?: string;
}

export const activeJobs = new Map<string, CertJob>();
