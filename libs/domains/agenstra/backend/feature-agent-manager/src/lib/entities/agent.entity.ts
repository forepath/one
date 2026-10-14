import type { EffectiveEgressPolicy, EffectiveMessageFilterRule } from '@forepath/agenstra/shared/util-opencode-config';
import { createAes256GcmTransformer } from '@forepath/shared/backend';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { GitRepositorySetupMode } from '../constants/git-repository-setup-mode';

export type AgentEgressStatus = 'inactive' | 'active' | 'failed';

/**
 * Container type enum representing the type of container.
 * This is used to identify what type of content the container contains.
 * Different tooling may be used depending on the container type.
 */
export enum ContainerType {
  GENERIC = 'generic',
  DOCKER = 'docker',
  TERRAFORM = 'terraform',
  KUBERNETES = 'kubernetes',
}

/**
 * Agent entity representing an agent in the system.
 * Each agent has a unique UUID identifier, name, description, and hashed password.
 */
@Entity('agents')
export class AgentEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 255, name: 'name' })
  name!: string;

  @Column({ type: 'text', nullable: true, name: 'description' })
  description?: string;

  @Column({ type: 'varchar', length: 255, name: 'hashed_password' })
  hashedPassword!: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'container_id' })
  containerId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'volume_path' })
  volumePath?: string;

  @Column({ type: 'varchar', length: 50, default: 'opencode', name: 'agent_type' })
  agentType!: string;

  @Column({ type: 'enum', enum: ContainerType, name: 'container_type', default: ContainerType.GENERIC })
  containerType!: ContainerType;

  /**
   * Basic-auth password for the worker's `opencode serve` HTTP API (`OPENCODE_SERVER_PASSWORD`).
   */
  @Column({
    type: 'varchar',
    length: 1024,
    nullable: true,
    name: 'opencode_server_password',
    transformer: createAes256GcmTransformer(),
  })
  opencodeServerPassword?: string;

  /** Per-agent OpenCode user config overlay (non-secret). */
  @Column({ type: 'jsonb', nullable: true, name: 'opencode_user_config' })
  opencodeUserConfig?: Record<string, unknown> | null;

  /** Per-agent raw OpenCode JSON overrides merged over {@link opencodeUserConfig}. */
  @Column({ type: 'jsonb', nullable: true, name: 'opencode_user_overrides' })
  opencodeUserOverrides?: Record<string, unknown> | null;

  /** Per-agent OpenCode secrets (JSON), AES-256-GCM encrypted. */
  @Column({
    type: 'text',
    nullable: true,
    name: 'opencode_user_secrets',
    transformer: createAes256GcmTransformer(),
  })
  opencodeUserSecrets?: string | null;

  /**
   * Values replaced by agent-level environment variables (JSON `{ [key]: string | null }`), restored when
   * a variable is removed. AES-256-GCM encrypted. `null` for agents created before this was tracked.
   * See `agent-environment-baseline.utils.ts`.
   */
  @Column({
    type: 'text',
    nullable: true,
    name: 'environment_variable_baseline',
    transformer: createAes256GcmTransformer(),
  })
  environmentVariableBaseline?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'git_repository_url' })
  gitRepositoryUrl?: string;

  @Column({ type: 'varchar', length: 16, nullable: true, name: 'git_repository_setup_mode' })
  gitRepositorySetupMode?: GitRepositorySetupMode;

  /**
   * Runtime session ids (OpenCode `ses…`) keyed by resumeSessionSuffix (empty string = primary chat).
   * Column name retained as `acp_sessions` for migration continuity.
   */
  @Column({ type: 'jsonb', nullable: true, name: 'acp_sessions' })
  acpSessions?: Record<string, string> | null;

  /**
   * Container id that owned {@link acpSessions}. Ignored when the agent container was replaced.
   */
  @Column({ type: 'varchar', length: 255, nullable: true, name: 'acp_session_container_id' })
  acpSessionContainerId?: string | null;

  /**
   * Egress guard sidecar owning this agent's network namespace (`NetworkMode: container:<id>`).
   * `null` when the agent never required egress filtering (legacy network topology).
   */
  @Column({ type: 'varchar', length: 255, nullable: true, name: 'egress_guard_container_id' })
  egressGuardContainerId?: string | null;

  /** Effective egress policy last received from the controller (layered agent configuration). */
  @Column({ type: 'jsonb', nullable: true, name: 'egress_policy' })
  egressPolicy?: EffectiveEgressPolicy | null;

  /** Revision of the guard policy bundle last applied successfully. */
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'egress_policy_revision' })
  egressPolicyRevision?: string | null;

  /** `inactive` (no enforcement) | `active` (guard applied) | `failed` (last apply failed; previous bundle kept). */
  @Column({ type: 'varchar', length: 16, nullable: true, name: 'egress_status' })
  egressStatus?: AgentEgressStatus | null;

  @Column({ type: 'text', nullable: true, name: 'egress_last_error' })
  egressLastError?: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'egress_applied_at' })
  egressAppliedAt?: Date | null;

  /** Docker log timestamp (RFC 3339 nano) up to which guard logs were collected. */
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'egress_log_cursor' })
  egressLogCursor?: string | null;

  /** Effective chat message filter rules (global → workspace → environment) last received from the controller. */
  @Column({ type: 'jsonb', nullable: true, name: 'message_filters' })
  messageFilters?: EffectiveMessageFilterRule[] | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
