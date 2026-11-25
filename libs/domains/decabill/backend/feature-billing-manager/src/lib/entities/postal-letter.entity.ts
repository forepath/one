import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import type { DeliverableDocumentType } from '../constants/document-delivery.constants';
import type { PostalLetterStatus } from '../constants/postal-letter.constants';

/**
 * One physical letter handed to a postal provider for a customer document. Carries its tenant explicitly: provider
 * webhooks arrive without a tenant context and are resolved through this row (provider + external id).
 */
@Entity('billing_postal_letters')
@Index('IDX_billing_postal_letters_document', ['documentType', 'documentId'])
@Index('UQ_billing_postal_letters_provider_external', ['provider', 'externalId'], { unique: true })
export class PostalLetterEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id' })
  tenantId!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 16, name: 'document_type' })
  documentType!: DeliverableDocumentType;

  /** Invoice id (invoices and credit notes) or offer id. */
  @Column({ type: 'uuid', name: 'document_id' })
  documentId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'document_number' })
  documentNumber?: string | null;

  @Column({ type: 'varchar', length: 64, name: 'provider' })
  provider!: string;

  @Column({ type: 'varchar', length: 255, name: 'external_id' })
  externalId!: string;

  @Column({ type: 'varchar', length: 32, name: 'status' })
  status!: PostalLetterStatus;

  /** Provider's last reason (issue / undeliverable), plain text. */
  @Column({ type: 'varchar', length: 500, nullable: true, name: 'status_reason' })
  statusReason?: string | null;

  /** The document's `sent_at` this letter claimed; webhooks release it only while it still matches. */
  @Column({ type: 'timestamp', name: 'claimed_at' })
  claimedAt!: Date;

  /**
   * Posted in addition to an email because the customer prefers letters: the document's sent state belongs to the
   * email, so this letter's lifecycle never releases or claims it.
   */
  @Column({ type: 'boolean', default: false, name: 'supplementary' })
  supplementary!: boolean;

  @Column({ type: 'boolean', default: false, name: 'cover_page' })
  coverPage!: boolean;

  @Column({ type: 'int', nullable: true, name: 'page_count' })
  pageCount?: number | null;

  @Column({ type: 'varchar', length: 2, nullable: true, name: 'country' })
  country?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'created_by_user_id' })
  createdByUserId?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
