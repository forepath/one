import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { InitiativeArtifactEntity } from './initiative-artifact.entity';

export type InitiativeArtifactVersionSource = 'human' | 'run' | 'proposal';

/** Immutable version of a document (history, diffs between iterations). */
@Entity('initiative_artifact_versions')
@Index('UQ_initiative_artifact_versions_artifact_version', ['artifactId', 'version'], { unique: true })
export class InitiativeArtifactVersionEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'artifact_id' })
  artifactId!: string;

  @ManyToOne(() => InitiativeArtifactEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'artifact_id' })
  artifact?: InitiativeArtifactEntity;

  @Column({ type: 'int', name: 'version' })
  version!: number;

  @Column({ type: 'text', name: 'content' })
  content!: string;

  @Column({ type: 'int', name: 'iteration' })
  iteration!: number;

  @Column({ type: 'varchar', length: 16, name: 'source' })
  source!: InitiativeArtifactVersionSource;

  @Column({ type: 'uuid', name: 'run_id', nullable: true })
  runId?: string | null;

  @Column({ type: 'uuid', name: 'proposal_id', nullable: true })
  proposalId?: string | null;

  @Column({ type: 'uuid', name: 'created_by_user_id', nullable: true })
  createdByUserId?: string | null;

  @Column({ type: 'uuid', name: 'agent_id', nullable: true })
  agentId?: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
