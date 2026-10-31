import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Desired state of one declarative resource (3.8: the API / control plane is the source of truth).
 * All kinds share one table; the spec is validated by the shared resource schemas before it is stored.
 */
@Entity('lw_resources')
@Index('IDX_lw_resources_identity', ['kind', 'projectKey', 'name'], { unique: true })
export class ResourceEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'kind' })
  kind!: string;

  /** Owning project; null for cluster-level resources. */
  @Column({ type: 'varchar', length: 63, name: 'project', nullable: true })
  project!: string | null;

  /** `''` for cluster scope so the unique index treats it like a value. */
  @Column({ type: 'varchar', length: 63, name: 'project_key', default: '' })
  projectKey!: string;

  @Column({ type: 'varchar', length: 63, name: 'name' })
  name!: string;

  @Column({ type: 'jsonb', name: 'labels', default: () => "'{}'" })
  labels!: Record<string, string>;

  @Column({ type: 'jsonb', name: 'annotations', default: () => "'{}'" })
  annotations!: Record<string, string>;

  @Column({ type: 'jsonb', name: 'spec' })
  spec!: Record<string, unknown>;

  /** Increments on every change; plans record the generation they were computed against. */
  @Column({ type: 'integer', name: 'generation', default: 1 })
  generation!: number;

  @Column({ type: 'varchar', length: 255, name: 'updated_by', nullable: true })
  updatedBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
