import { createAes256GcmTransformer } from '@forepath/shared/backend';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { GitRepositorySetupMode } from '../constants/git-repository-setup-mode';

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

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'vnc_container_id' })
  vncContainerId?: string;

  @Column({ type: 'integer', nullable: true, name: 'vnc_host_port' })
  vncHostPort?: number;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'vnc_network_id' })
  vncNetworkId?: string;

  @Column({
    type: 'varchar',
    length: 1024,
    nullable: true,
    name: 'vnc_password',
    transformer: createAes256GcmTransformer(),
  })
  vncPassword?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'ssh_container_id' })
  sshContainerId?: string;

  @Column({ type: 'integer', nullable: true, name: 'ssh_host_port' })
  sshHostPort?: number;

  @Column({
    type: 'varchar',
    length: 1024,
    nullable: true,
    name: 'ssh_password',
    transformer: createAes256GcmTransformer(),
  })
  sshPassword?: string;

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

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
