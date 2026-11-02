import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

/**
 * A saved view (3.37): the opaque console state (query, filters, columns, sort, tree view, density …) of one list
 * (`scope`) under a name, private to its owner (user id, `api-key` or the verified fleet person `fleet:<iss>:<sub>`).
 */
@Entity('lw_saved_views')
@Unique('UQ_lw_saved_views_owner_scope_name', ['owner', 'scope', 'name'])
@Index('IDX_lw_saved_views_owner_scope', ['owner', 'scope'])
export class SavedViewEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 255, name: 'owner' })
  owner!: string;

  @Column({ type: 'varchar', length: 100, name: 'scope' })
  scope!: string;

  @Column({ type: 'varchar', length: 100, name: 'name' })
  name!: string;

  @Column({ type: 'jsonb', name: 'state', default: () => "'{}'::jsonb" })
  state!: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}

export const SAVED_VIEWS_ENTITIES = [SavedViewEntity];
