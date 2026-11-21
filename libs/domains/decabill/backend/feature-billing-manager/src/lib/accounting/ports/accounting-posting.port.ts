import type { EntityManager } from 'typeorm';

/**
 * Hooks the billing domain calls inside its own DB transactions so bookings are written atomically with the
 * business change. Implementations must be idempotent (keyed by source + event) and must never throw: failures
 * are recorded as posting issues (inside a savepoint) and retried by the catch-up job, so billing keeps working
 * when accounting is disabled or misconfigured.
 */
export interface AccountingPostingPort {
  onInvoiceIssued(manager: EntityManager, invoiceId: string): Promise<void>;
  onInvoiceVoided(manager: EntityManager, invoiceId: string): Promise<void>;
  onCreditDocumentCreated(manager: EntityManager, creditDocumentId: string): Promise<void>;
  onSettlementApplied(manager: EntityManager, settlementId: string): Promise<void>;
  onSupplierInvoiceIssued(manager: EntityManager, supplierInvoiceId: string): Promise<void>;
  onSupplierInvoiceVoided(manager: EntityManager, supplierInvoiceId: string): Promise<void>;
  onInventoryMovementBooked(manager: EntityManager, movementId: string): Promise<void>;
}

export const ACCOUNTING_POSTING_PORT = Symbol('ACCOUNTING_POSTING_PORT');
