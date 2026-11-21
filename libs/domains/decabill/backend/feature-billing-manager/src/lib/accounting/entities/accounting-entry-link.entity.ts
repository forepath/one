import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { JournalLinkRole, JournalLinkType } from '../constants/accounting.constants';

/**
 * Link between a journal entry and any document or transaction (invoice, credit note, supplier invoice,
 * settlement, bank line, stock movement, asset, uploaded receipt, VAT return, other entries …). Enables reverse
 * lookup from documents to their bookings. Links of entries in locked periods can be added but not removed.
 */
@Entity('billing_accounting_entry_links')
@Index('uq_billing_accounting_entry_links', ['entryId', 'linkType', 'targetId', 'role'], { unique: true })
@Index('idx_billing_accounting_entry_links_target', ['linkType', 'targetId'])
export class AccountingEntryLinkEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'entry_id' })
  entryId!: string;

  @Column({ type: 'varchar', length: 32, name: 'link_type' })
  linkType!: JournalLinkType;

  @Column({ type: 'varchar', length: 64, name: 'target_id' })
  targetId!: string;

  @Column({ type: 'varchar', length: 16, name: 'role' })
  role!: JournalLinkRole;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'label' })
  label?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'created_by_user_id' })
  createdByUserId?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
