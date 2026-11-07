import type {
  AgentGraphBuildStatus,
  AgentGraphLayer,
  AgentGraphLayerStats,
} from '@forepath/agenstra/shared/util-opencode-config';
import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import type { AgentGraphListedEntry, AgentGraphParsedFile } from '../utils/agent-graph-builder.utils';
import type { AgentGraphImplicitContext } from '../utils/agent-graph-references.utils';

import { AgentEntity } from './agent.entity';

/**
 * Graph index of one environment (agent). Holds the worker file listing and per-file scan results (so rebuilds only
 * stream changed files) plus status / stats. The code and paths layers are derived from these on load; nothing is
 * stored inside the environment's container.
 */
@Entity('agent_graphs')
export class AgentGraphEntity {
  @PrimaryColumn({ name: 'agent_id', type: 'uuid' })
  agentId!: string;

  @OneToOne(() => AgentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent?: AgentEntity;

  @Column({ type: 'varchar', length: 16, default: 'missing' })
  status!: AgentGraphBuildStatus;

  @Column({ name: 'built_at', type: 'timestamptz', nullable: true })
  builtAt!: Date | null;

  @Column({ name: 'build_duration_ms', type: 'integer', nullable: true })
  buildDurationMs!: number | null;

  @Column({ type: 'boolean', default: false })
  truncated!: boolean;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ name: 'file_count', type: 'integer', default: 0 })
  fileCount!: number;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  languages!: Record<string, number>;

  @Column({ name: 'layer_stats', type: 'jsonb', default: () => "'{}'::jsonb" })
  layerStats!: Partial<Record<AgentGraphLayer, AgentGraphLayerStats>>;

  /** Large: only selected when the graph is loaded (see AgentGraphsRepository). */
  @Column({ type: 'jsonb', nullable: true, select: false })
  listing!: AgentGraphListedEntry[] | null;

  /** Large: only selected when the graph is loaded (see AgentGraphsRepository). */
  @Column({ type: 'jsonb', nullable: true, select: false })
  parsed!: Record<string, AgentGraphParsedFile> | null;

  /** Instruction / rule / skill files found in the working directory (implicit prompt context). */
  @Column({ name: 'instruction_files', type: 'jsonb', default: () => "'[]'::jsonb" })
  instructionFiles!: { path: string; label: string }[];

  /** Mount ids of other environments referenced by this one (`/opt/workspace/<mount id>` paths in prompts). */
  @Column({ name: 'referenced_mount_ids', type: 'jsonb', default: () => "'[]'::jsonb" })
  referencedMountIds!: string[];

  /** Names of the implicitly loaded OpenCode configuration (captured on config sync). */
  @Column({ name: 'implicit_context', type: 'jsonb', nullable: true })
  implicitContext!: AgentGraphImplicitContext | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
