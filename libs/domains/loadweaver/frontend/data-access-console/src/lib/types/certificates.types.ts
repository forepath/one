/** An ingress certificate (`GET /certificates`): ACME-issued or uploaded; private keys are never returned. */
export interface CertificateSummary {
  id: string;
  names: string[];
  source: 'acme' | 'custom';
  notAfter: string | null;
  failures: number;
  lastError: string | null;
}
