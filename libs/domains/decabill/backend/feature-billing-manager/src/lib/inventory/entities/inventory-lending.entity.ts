import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { InventoryLendingStatus } from '../constants/inventory.constants';

import { InventoryArticleEntity } from './inventory-article.entity';
import { InventoryCompartmentEntity } from './inventory-compartment.entity';

/**
 * Stock on loan: opened by a `lending` movement (document `LND-…`), closed by one or more `lending_return` movements.
 * The borrower is a user (customer, or an administrator as staff) or a named employee without an account.
 */
@Entity('billing_inventory_lendings')
@Index('idx_billing_inventory_lendings_status', ['tenantId', 'status'])
export class InventoryLendingEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id', default: 'default' })
  tenantId!: string;

  @Index('idx_billing_inventory_lendings_article')
  @Column({ type: 'uuid', name: 'article_id' })
  articleId!: string;

  @ManyToOne(() => InventoryArticleEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'article_id' })
  article?: InventoryArticleEntity;

  /** Number of the lending document (`LND-…`); set when the lending movement is booked. */
  @Column({ type: 'varchar', length: 32, nullable: true, name: 'document_number' })
  documentNumber?: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 3, name: 'quantity' })
  quantity!: number | string;

  @Column({ type: 'decimal', precision: 14, scale: 3, default: 0, name: 'returned_quantity' })
  returnedQuantity!: number | string;

  @Column({ type: 'varchar', length: 16, name: 'status' })
  status!: InventoryLendingStatus;

  @Index('idx_billing_inventory_lendings_borrower')
  @Column({ type: 'uuid', nullable: true, name: 'borrower_user_id' })
  borrowerUserId?: string | null;

  /** Display name at lending time (customer name / email, or the employee's name). */
  @Column({ type: 'varchar', length: 255, name: 'borrower_name' })
  borrowerName!: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'borrower_email' })
  borrowerEmail?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true, name: 'borrower_customer_number' })
  borrowerCustomerNumber?: string | null;

  @Column({ type: 'varchar', length: 16, name: 'borrower_kind' })
  borrowerKind!: 'customer' | 'staff';

  @Column({ type: 'uuid', name: 'source_compartment_id' })
  sourceCompartmentId!: string;

  @ManyToOne(() => InventoryCompartmentEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'source_compartment_id' })
  sourceCompartment?: InventoryCompartmentEntity;

  /** Agreed return date (`YYYY-MM-DD`). */
  @Column({ type: 'date', nullable: true, name: 'due_date' })
  dueDate?: string | null;

  @Column({ type: 'text', nullable: true, name: 'note' })
  note?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'lent_by_user_id' })
  lentByUserId?: string | null;

  @Column({ type: 'timestamp', nullable: true, name: 'returned_at' })
  returnedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
