import { DEFAULT_TENANT } from '@forepath/shared/backend';

export interface BillingJobTenantPayload {
  tenantId?: string;
}

export interface ResolveBillingJobTenantIdContext {
  jobName: string;
  jobId?: string;
}

export interface BillingJobTenantLogger {
  warn(message: string): void;
}

/**
 * Resolves tenant for a billing queue job.
 * New jobs must include `tenantId`; pre-tenancy backlog jobs fall back to `default`.
 */
export function resolveBillingJobTenantId(
  payload: BillingJobTenantPayload,
  context: ResolveBillingJobTenantIdContext,
  logger?: BillingJobTenantLogger,
): string {
  const tenantId = payload.tenantId?.trim();

  if (tenantId) {
    return tenantId;
  }

  const jobRef = context.jobId ? ` (${context.jobId})` : '';

  logger?.warn(
    `Billing job "${context.jobName}"${jobRef} missing tenantId; using "${DEFAULT_TENANT}" for legacy backlog compatibility`,
  );

  return DEFAULT_TENANT;
}

export function requireTenantIdForEnqueue(jobName: string, payload: BillingJobTenantPayload): string {
  const tenantId = payload.tenantId?.trim();

  if (!tenantId) {
    throw new Error(`Cannot enqueue ${jobName} without tenantId`);
  }

  return tenantId;
}
