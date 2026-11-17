import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { InventoryMovementReason, InventoryMovementType } from '../constants/inventory.constants';

/**
 * One stock movement (putaway, transfer or withdrawal) and its numbered document. Location and article details are
 * snapshotted so the document stays reproducible after master data changes.
 */
@Entity('billing_inventory_movements')
@Index('uq_billing_inventory_movements_number_scope_number', ['numberScope', 'documentNumber'], { unique: true })
export class InventoryMovementEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id', default: 'default' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 16, name: 'type' })
  type!: InventoryMovementType;

  /** `PUT-` / `TRF-` / `WDR-` / `LND-` / `RTN-{year}-{nnnnn}`. */
  @Column({ type: 'varchar', length: 32, name: 'document_number' })
  documentNumber!: string;

  @Column({ type: 'varchar', length: 64, name: 'number_scope', default: '__shared__' })
  numberScope!: string;

  @Column({ type: 'uuid', name: 'article_id' })
  articleId!: string;

  @Column({ type: 'decimal', precision: 14, scale: 3, name: 'quantity' })
  quantity!: number | string;

  @Column({ type: 'varchar', length: 16, nullable: true, name: 'reason' })
  reason?: InventoryMovementReason | null;

  @Column({ type: 'uuid', nullable: true, name: 'source_compartment_id' })
  sourceCompartmentId?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'target_compartment_id' })
  targetCompartmentId?: string | null;

  /** Stock of the source placement after the movement. */
  @Column({ type: 'decimal', precision: 14, scale: 3, nullable: true, name: 'source_quantity_after' })
  sourceQuantityAfter?: number | string | null;

  /** Stock of the target placement after the movement. */
  @Column({ type: 'decimal', precision: 14, scale: 3, nullable: true, name: 'target_quantity_after' })
  targetQuantityAfter?: number | string | null;

  /** Article / location snapshot printed on the document. */
  @Column({ type: 'jsonb', name: 'snapshot' })
  snapshot!: InventoryMovementSnapshot;

  /** External reference such as a delivery note or purchase order number. */
  @Column({ type: 'varchar', length: 255, nullable: true, name: 'reference' })
  reference?: string | null;

  @Column({ type: 'text', nullable: true, name: 'note' })
  note?: string | null;

  /** Serial numbers moved (serial-tracked articles; ordered as entered). */
  @Column({ type: 'jsonb', nullable: true, name: 'serial_numbers' })
  serialNumbers?: string[] | null;

  /** Lending this movement opened (`lending`) or returned stock of (`lending_return`). */
  @Index('idx_billing_inventory_movements_lending')
  @Column({ type: 'uuid', nullable: true, name: 'lending_id' })
  lendingId?: string | null;

  @Index('idx_billing_inventory_movements_request')
  @Column({ type: 'uuid', nullable: true, name: 'withdrawal_request_id' })
  withdrawalRequestId?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'performed_by_user_id' })
  performedByUserId?: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true, name: 'pdf_storage_key' })
  pdfStorageKey?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

export interface InventoryMovementLocationSnapshot {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  compartmentId: string;
  compartmentCode: string;
  compartmentName: string | null;
}

export interface InventoryMovementSnapshot {
  article: {
    articleNumber: string;
    name: string;
    ean: string | null;
    unit: string;
  };
  source: InventoryMovementLocationSnapshot | null;
  target: InventoryMovementLocationSnapshot | null;
  performedByEmail: string | null;
  /** Borrower and due date of a lending (also on its returns). */
  lending?: InventoryLendingSnapshot | null;
  /** Origin of a fulfilled withdrawal request (customer and document numbers). */
  request: {
    sourceType: string;
    reference: string;
    customerNumber: string | null;
    customerName: string | null;
  } | null;
}

export interface InventoryLendingSnapshot {
  /** Document number of the lending (`LND-…`). */
  documentNumber: string | null;
  borrowerName: string;
  borrowerEmail: string | null;
  borrowerCustomerNumber: string | null;
  borrowerKind: 'customer' | 'staff';
  dueDate: string | null;
}
