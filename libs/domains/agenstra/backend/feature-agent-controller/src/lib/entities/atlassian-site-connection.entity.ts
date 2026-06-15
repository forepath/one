import { createAes256GcmTransformer } from '@forepath/shared/backend';
import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { ExternalImportConfigEntity } from './external-import-config.entity';

/** Atlassian site connection; `apiToken` is AES-256-GCM encrypted at rest in column `api_token`. */
@Entity('atlassian_site_connections')
export class AtlassianSiteConnectionEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 200, nullable: true, name: 'label' })
  label?: string | null;

  @Column({ type: 'varchar', length: 512, name: 'base_url' })
  baseUrl!: string;

  @Column({ type: 'varchar', length: 320, name: 'account_email' })
  accountEmail!: string;

  @Column({
    type: 'text',
    name: 'api_token',
    transformer: createAes256GcmTransformer(),
  })
  apiToken!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => ExternalImportConfigEntity, (c) => c.atlassianConnection)
  importConfigs!: ExternalImportConfigEntity[];
}
