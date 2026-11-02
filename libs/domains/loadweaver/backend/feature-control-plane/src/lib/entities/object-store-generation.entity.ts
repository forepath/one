import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

import type { GenerationState } from '../object-store/object-store.utils';

/**
 * One Garage cluster of the built-in object store (3.20). The replication factor is fixed per generation; changing
 * it means a new generation, a copy and a switch-over.
 */
@Entity('lw_object_store_generations')
export class ObjectStoreGenerationEntity {
  @PrimaryColumn({ type: 'integer', name: 'generation' })
  generation!: number;

  @Column({ type: 'integer', name: 'replication_factor' })
  replicationFactor!: number;

  @Column({ type: 'varchar', length: 16, name: 'state' })
  state!: GenerationState;

  /** Nodes running this generation: the members, plus former members until Garage moved their data away. */
  @Column({ type: 'jsonb', name: 'holders', default: () => "'[]'" })
  holders!: string[];

  /** Garage node id per holder, learned from the admin API. */
  @Column({ type: 'jsonb', name: 'garage_nodes', default: () => "'{}'" })
  garageNodes!: Record<string, string>;

  @Column({ type: 'jsonb', name: 'observed_members', default: () => "'[]'" })
  observedMembers!: string[];

  @Column({ type: 'timestamptz', name: 'observed_since' })
  observedSince!: Date;

  @Column({ type: 'timestamptz', name: 'state_changed_at' })
  stateChangedAt!: Date;

  /** Copy into this generation: a live pass, then a final pass while the registries are read-only. */
  @Column({ type: 'jsonb', name: 'copy', nullable: true })
  copy!: {
    phase: 'live' | 'final' | 'sweep';
    continuationToken?: string;
    /** Objects copied by the live and final passes. */
    copied: number;
    /** Objects the sweep removed from the new generation (absent before the sweep). */
    removed?: number;
    readOnlySince?: string;
    /** Index into the copied buckets (registry, files); each phase walks all of them. */
    bucket?: number;
  } | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
