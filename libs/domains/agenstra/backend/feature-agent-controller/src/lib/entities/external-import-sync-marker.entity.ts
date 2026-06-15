import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ExternalImportConfigEntity } from './external-import-config.entity';
import { ExternalImportMarkerType } from './external-import.enums';
import { KnowledgeNodeEntity } from './knowledge-node.entity';
import { TicketEntity } from './ticket.entity';

@Entity('external_import_sync_markers')
export class ExternalImportSyncMarkerEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'import_config_id' })
  importConfigId!: string;

  @ManyToOne(() => ExternalImportConfigEntity, (c) => c.syncMarkers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'import_config_id' })
  importConfig!: ExternalImportConfigEntity;

  @Column({ type: 'varchar', length: 32, name: 'external_type' })
  externalType!: ExternalImportMarkerType;

  @Column({ type: 'varchar', length: 256, name: 'external_id' })
  externalId!: string;

  @Column({ type: 'uuid', nullable: true, name: 'local_ticket_id' })
  localTicketId?: string | null;

  @ManyToOne(() => TicketEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'local_ticket_id' })
  localTicket?: TicketEntity | null;

  @Column({ type: 'uuid', nullable: true, name: 'local_knowledge_node_id' })
  localKnowledgeNodeId?: string | null;

  @ManyToOne(() => KnowledgeNodeEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'local_knowledge_node_id' })
  localKnowledgeNode?: KnowledgeNodeEntity | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'content_hash' })
  contentHash?: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'last_imported_at' })
  lastImportedAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
