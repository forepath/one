import { createHash } from 'crypto';

import type { InitiativeArtifactType } from '@forepath/agenstra/shared/util-initiative-method';
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

import { InitiativeWorkItemEntity } from './initiative-work-item.entity';
import { InitiativeEntity } from './initiative.entity';

/**
 * A planning document of an initiative (PRD, architecture, …) or of one of its epics (retrospective). The current
 * content is kept here; every version is kept in `initiative_artifact_versions`. Accepted = the current version is the
 * accepted one (the shared contract).
 */
@Entity('initiative_artifacts')
@Index('IDX_initiative_artifacts_initiative', ['initiativeId'])
@Index('IDX_initiative_artifacts_client_long_sha', ['clientId', 'longSha'])
export class InitiativeArtifactEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'initiative_id' })
  initiativeId!: string;

  @ManyToOne(() => InitiativeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'initiative_id' })
  initiative?: InitiativeEntity;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @Column({ type: 'varchar', length: 32, name: 'type' })
  type!: InitiativeArtifactType;

  /** Epic scope (retrospectives, epic documents); `null` for initiative-wide documents. */
  @Column({ type: 'uuid', name: 'work_item_id', nullable: true })
  workItemId?: string | null;

  @ManyToOne(() => InitiativeWorkItemEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'work_item_id' })
  workItem?: InitiativeWorkItemEntity | null;

  @Column({ type: 'varchar', length: 500, name: 'title' })
  title!: string;

  @Column({ type: 'text', name: 'content', default: '' })
  content!: string;

  @Column({ type: 'int', name: 'current_version', default: 1 })
  currentVersion!: number;

  @Column({ type: 'int', name: 'accepted_version', nullable: true })
  acceptedVersion?: number | null;

  @Column({ type: 'timestamptz', name: 'accepted_at', nullable: true })
  acceptedAt?: Date | null;

  @Column({ type: 'uuid', name: 'accepted_by_user_id', nullable: true })
  acceptedByUserId?: string | null;

  /** Knowledge page the document was last published to (snapshot copy). */
  @Column({ type: 'uuid', name: 'published_node_id', nullable: true })
  publishedNodeId?: string | null;

  @Column({ type: 'int', name: 'version', default: 1 })
  version!: number;

  @Column({ type: 'varchar', length: 40, name: 'long_sha', nullable: true })
  longSha?: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  static deriveLongSha(id: string): string {
    return createHash('sha1').update(id).digest('hex');
  }
}
