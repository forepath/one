import { ClientEntity } from '@forepath/identity/backend';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { AtlassianSiteConnectionEntity } from './atlassian-site-connection.entity';
import { ExternalImportSyncMarkerEntity } from './external-import-sync-marker.entity';
import { ExternalImportKind, ExternalImportProviderId } from './external-import.enums';
import { KnowledgeNodeEntity } from './knowledge-node.entity';
import { TicketEntity } from './ticket.entity';
import { TicketStatus } from './ticket.enums';

@Entity('external_import_configs')
export class ExternalImportConfigEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 32, name: 'provider' })
  provider!: ExternalImportProviderId;

  @Column({ type: 'varchar', length: 32, name: 'import_kind' })
  importKind!: ExternalImportKind;

  @Column({ type: 'uuid', name: 'atlassian_connection_id' })
  atlassianConnectionId!: string;

  @ManyToOne(() => AtlassianSiteConnectionEntity, (c) => c.importConfigs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'atlassian_connection_id' })
  atlassianConnection!: AtlassianSiteConnectionEntity;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @ManyToOne(() => ClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client!: ClientEntity;

  @Column({ type: 'boolean', name: 'enabled', default: true })
  enabled!: boolean;

  @Column({ type: 'int', nullable: true, name: 'jira_board_id' })
  jiraBoardId?: number | null;

  @Column({ type: 'text', nullable: true, name: 'jql' })
  jql?: string | null;

  @Column({
    type: 'varchar',
    length: 32,
    name: 'import_target_ticket_status',
    default: TicketStatus.DRAFT,
  })
  importTargetTicketStatus!: TicketStatus;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'confluence_space_key' })
  confluenceSpaceKey?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'confluence_root_page_id' })
  confluenceRootPageId?: string | null;

  @Column({ type: 'text', nullable: true, name: 'cql' })
  cql?: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'agenstra_parent_ticket_id' })
  agenstraParentTicketId?: string | null;

  @ManyToOne(() => TicketEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'agenstra_parent_ticket_id' })
  agenstraParentTicket?: TicketEntity | null;

  @Column({ type: 'uuid', nullable: true, name: 'agenstra_parent_folder_id' })
  agenstraParentFolderId?: string | null;

  @ManyToOne(() => KnowledgeNodeEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'agenstra_parent_folder_id' })
  agenstraParentFolder?: KnowledgeNodeEntity | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'last_run_at' })
  lastRunAt?: Date | null;

  @Column({ type: 'text', nullable: true, name: 'last_error' })
  lastError?: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => ExternalImportSyncMarkerEntity, (m) => m.importConfig)
  syncMarkers!: ExternalImportSyncMarkerEntity[];
}
