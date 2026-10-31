import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type DraftStatus = 'open' | 'submitted' | 'discarded';

/** One operation of a draft (3.36): upsert a resource document or delete a resource; one per resource key. */
export interface DraftOp {
  op: 'upsert' | 'delete';
  kind: string;
  name: string;
  project: string | null;
  /** The resource as one YAML document (upserts only). */
  document?: string;
  /** `metadata.generation` the op was based on (0 = the resource did not exist); a moved generation is a conflict. */
  baseGeneration: number;
  /** Who set the op (user id / fleet person / `api-key`) and when. */
  by: string;
  at: string;
}

/**
 * A server-side, shared Workspace draft (3.36): edits collected as ops until they are submitted as an ordinary plan.
 * Visible / editable to the owner and to writers of every touched project (+ the cluster role cluster-level kinds
 * need); `version` guards concurrent edits (optimistic concurrency).
 */
@Entity('lw_drafts')
@Index('IDX_lw_drafts_status_updated', ['status', 'updatedAt'])
export class DraftEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 200, name: 'title' })
  title!: string;

  @Column({ type: 'varchar', length: 255, name: 'owner' })
  owner!: string;

  /** Touched projects, derived from the ops. */
  @Column({ type: 'jsonb', name: 'projects', default: () => "'[]'::jsonb" })
  projects!: string[];

  /** Cluster permission the ops need (`infra` / `admin`), null when only project resources are touched. */
  @Column({ type: 'varchar', length: 16, name: 'cluster_scope', nullable: true })
  clusterScope!: 'infra' | 'admin' | null;

  @Column({ type: 'jsonb', name: 'ops', default: () => "'[]'::jsonb" })
  ops!: DraftOp[];

  @Column({ type: 'integer', name: 'version', default: 1 })
  version!: number;

  @Column({ type: 'varchar', length: 16, name: 'status', default: 'open' })
  status!: DraftStatus;

  @Column({ type: 'uuid', name: 'plan_id', nullable: true })
  planId!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}

export const DRAFTS_ENTITIES = [DraftEntity];
