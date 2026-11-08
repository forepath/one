import type {
  ConnectionAuthType,
  ConnectionTestStatus,
  DeploymentConnectionWorkspaceAccess,
  DeploymentProvider,
} from '@forepath/agenstra/shared/util-opencode-config';
import { createAes256GcmTransformer } from '@forepath/shared/backend';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Secret part of a deployment connection, stored as JSON in the AES-256-GCM encrypted `credentials` column.
 * - `token`: `token` (GitHub / GitLab access token, Jenkins API token)
 * - `app`: `privateKey` (GitHub App PEM)
 */
export interface DeploymentConnectionSecrets {
  token?: string;
  privateKey?: string;
}

/**
 * Instance-wide CI/CD connection (admin managed, `/connections/deployments`). Workspaces build deployment workflows on
 * top of it; credentials never leave the controller.
 */
@Entity('deployment_connections')
@Index('IDX_deployment_connections_provider', ['provider'])
export class DeploymentConnectionEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 200, name: 'label' })
  label!: string;

  @Column({ type: 'varchar', length: 32, name: 'provider' })
  provider!: DeploymentProvider;

  /** Self-hosted API base URL; null: provider default (api.github.com, gitlab.com). Required for Jenkins. */
  @Column({ type: 'varchar', length: 512, name: 'base_url', nullable: true })
  baseUrl?: string | null;

  @Column({ type: 'varchar', length: 16, name: 'auth_type' })
  authType!: ConnectionAuthType;

  /** GitHub App id (`app`). */
  @Column({ type: 'varchar', length: 64, name: 'app_id', nullable: true })
  appId?: string | null;

  /** GitHub App installation id (`app`). */
  @Column({ type: 'varchar', length: 64, name: 'installation_id', nullable: true })
  installationId?: string | null;

  /** Jenkins user of the API token (`token`). */
  @Column({ type: 'varchar', length: 320, name: 'username', nullable: true })
  username?: string | null;

  /** JSON of {@link DeploymentConnectionSecrets}, encrypted at rest. */
  @Column({ type: 'text', name: 'credentials', transformer: createAes256GcmTransformer() })
  credentials!: string;

  @Column({ type: 'varchar', length: 16, name: 'workspace_access', default: 'all' })
  workspaceAccess!: DeploymentConnectionWorkspaceAccess;

  /** Workspaces allowed to use the connection (`workspace_access = selected`). */
  @Column({ type: 'jsonb', name: 'allowed_client_ids', default: () => "'[]'::jsonb" })
  allowedClientIds!: string[];

  @Column({ type: 'varchar', length: 16, name: 'last_test_status', default: 'untested' })
  lastTestStatus!: ConnectionTestStatus;

  @Column({ type: 'varchar', length: 512, name: 'last_test_message', nullable: true })
  lastTestMessage?: string | null;

  @Column({ type: 'timestamptz', name: 'last_tested_at', nullable: true })
  lastTestedAt?: Date | null;

  @Column({ type: 'uuid', name: 'created_by_user_id', nullable: true })
  createdByUserId?: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
