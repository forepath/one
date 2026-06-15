import { ClientEntity } from '@forepath/identity/backend';
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { KnowledgeNodeEntity } from './knowledge-node.entity';
import { KnowledgeRelationSourceType, KnowledgeRelationTargetType } from './knowledge-node.enums';

@Entity('knowledge_relations')
export class KnowledgeRelationEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @ManyToOne(() => ClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client!: ClientEntity;

  @Column({
    type: 'enum',
    enum: KnowledgeRelationSourceType,
    enumName: 'knowledge_relation_source_type_enum',
    name: 'source_type',
  })
  sourceType!: KnowledgeRelationSourceType;

  @Column({ type: 'uuid', name: 'source_id' })
  sourceId!: string;

  @Column({
    type: 'enum',
    enum: KnowledgeRelationTargetType,
    enumName: 'knowledge_relation_target_type_enum',
    name: 'target_type',
  })
  targetType!: KnowledgeRelationTargetType;

  @Column({ type: 'uuid', nullable: true, name: 'target_node_id' })
  targetNodeId?: string | null;

  @ManyToOne(() => KnowledgeNodeEntity, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'target_node_id' })
  targetNode?: KnowledgeNodeEntity | null;

  @Column({ type: 'varchar', length: 40, nullable: true, name: 'target_ticket_long_sha' })
  targetTicketLongSha?: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
