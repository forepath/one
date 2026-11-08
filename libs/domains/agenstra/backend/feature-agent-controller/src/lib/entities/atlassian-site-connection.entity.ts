import type { ConnectionAuthType, ConnectionTestStatus } from '@forepath/agenstra/shared/util-opencode-config';
import { createAes256GcmTransformer } from '@forepath/shared/backend';
import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { ExternalImportConfigEntity } from './external-import-config.entity';

/**
 * Atlassian site connection (`/connections/atlassian`).
 * - `token`: `accountEmail` + `apiToken` (HTTP Basic against the site URL).
 * - `app`: OAuth 2.0 client credentials of an Atlassian service account (`oauthClientId` + `oauthClientSecret`);
 *   REST goes through `api.atlassian.com/ex/{product}/{cloudId}`, `cloudId` is cached from `{site}/_edge/tenant_info`.
 *
 * `apiToken` and `oauthClientSecret` are AES-256-GCM encrypted at rest and never leave the controller.
 */
@Entity('atlassian_site_connections')
export class AtlassianSiteConnectionEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 200, nullable: true, name: 'label' })
  label?: string | null;

  @Column({ type: 'varchar', length: 512, name: 'base_url' })
  baseUrl!: string;

  @Column({ type: 'varchar', length: 16, name: 'auth_type', default: 'token' })
  authType!: ConnectionAuthType;

  @Column({ type: 'varchar', length: 320, name: 'account_email', nullable: true })
  accountEmail?: string | null;

  @Column({
    type: 'text',
    name: 'api_token',
    nullable: true,
    transformer: createAes256GcmTransformer(),
  })
  apiToken?: string | null;

  @Column({ type: 'varchar', length: 255, name: 'oauth_client_id', nullable: true })
  oauthClientId?: string | null;

  @Column({
    type: 'text',
    name: 'oauth_client_secret',
    nullable: true,
    transformer: createAes256GcmTransformer(),
  })
  oauthClientSecret?: string | null;

  @Column({ type: 'varchar', length: 64, name: 'cloud_id', nullable: true })
  cloudId?: string | null;

  @Column({ type: 'varchar', length: 16, name: 'last_test_status', default: 'untested' })
  lastTestStatus!: ConnectionTestStatus;

  @Column({ type: 'varchar', length: 512, name: 'last_test_message', nullable: true })
  lastTestMessage?: string | null;

  @Column({ type: 'timestamptz', name: 'last_tested_at', nullable: true })
  lastTestedAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => ExternalImportConfigEntity, (c) => c.atlassianConnection)
  importConfigs!: ExternalImportConfigEntity[];
}
