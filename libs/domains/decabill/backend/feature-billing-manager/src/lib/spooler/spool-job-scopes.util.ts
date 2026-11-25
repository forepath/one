import type { SpoolJobEntity } from './entities/spool-job.entity';
import { SpoolJobKind } from './spooler.constants';

/**
 * Domain scopes a token needs (besides `spooler:admin`) to act on a job: the same scopes the route that created the
 * job requires, so the spooler never lets a token re-send a document, post a letter or read a printout it could not
 * have produced itself.
 */
export function requiredScopesForSpoolJob(job: Pick<SpoolJobEntity, 'kind' | 'documentType' | 'payload'>): string[] {
  switch (job.kind) {
    case SpoolJobKind.DOCUMENT_SEND: {
      const domain = job.documentType === 'offer' ? 'offers:admin' : 'invoices:admin';

      return job.payload?.['channel'] === 'letter' ? [domain, 'letters:admin'] : [domain];
    }

    case SpoolJobKind.INVENTORY_LABELS:
    case SpoolJobKind.INVENTORY_MOVEMENT:
      return ['inventory:admin'];
    case SpoolJobKind.PROJECT_TIME_REPORT:
      return ['projects:admin'];
    default:
      // Unknown kinds are never actionable by tokens (fail closed).
      return ['billing:admin', 'spooler:admin', '__unknown_spool_kind__:admin'];
  }
}
