import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A silenced action center type or item. `userId = null` silences it for everyone in the scope (admins only),
 * otherwise only for that user. `itemId = null` silences the whole type. Uniqueness over
 * (scope, user, type, item) is enforced by an expression index in the migration (NULL-safe).
 */
@Entity('action_center_silences')
@Index('idx_action_center_silences_scope', ['scopeKey'])
export class ActionCenterSilenceEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'scope_key' })
  scopeKey!: string;

  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId!: string | null;

  @Column({ type: 'varchar', length: 128, name: 'item_type' })
  itemType!: string;

  @Column({ type: 'varchar', length: 128, name: 'item_id', nullable: true })
  itemId!: string | null;

  @Column({ type: 'timestamptz', name: 'until', nullable: true })
  until!: Date | null;

  @Column({ type: 'uuid', name: 'created_by_user_id', nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
