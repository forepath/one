import { ClientEntity } from '@forepath/identity/backend';
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

import { KnowledgeNodeEntity } from './knowledge-node.entity';

@Entity('knowledge_node_embeddings')
@Index('IDX_knowledge_node_embeddings_client_id', ['clientId'])
@Index('IDX_knowledge_node_embeddings_node_id', ['knowledgeNodeId'])
@Index('IDX_knowledge_node_embeddings_client_node_chunk', ['clientId', 'knowledgeNodeId', 'chunkIndex'], {
  unique: true,
})
export class KnowledgeNodeEmbeddingEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @ManyToOne(() => ClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client!: ClientEntity;

  @Column({ type: 'uuid', name: 'knowledge_node_id' })
  knowledgeNodeId!: string;

  @ManyToOne(() => KnowledgeNodeEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'knowledge_node_id' })
  knowledgeNode!: KnowledgeNodeEntity;

  @Column({ type: 'int', name: 'chunk_index' })
  chunkIndex!: number;

  @Column({ type: 'text', name: 'chunk_text' })
  chunkText!: string;

  /**
   * pgvector column declared as "vector" to avoid coupling entity code to a fixed dimension.
   * Dimension constraints are enforced by migration and provider configuration.
   */
  @Column({ type: 'vector', name: 'embedding' })
  embedding!: number[];

  @Column({ type: 'varchar', length: 128, name: 'embedding_model' })
  embeddingModel!: string;

  @Column({ type: 'varchar', length: 64, name: 'embedding_provider' })
  embeddingProvider!: string;

  @Column({ type: 'varchar', length: 64, name: 'content_hash' })
  contentHash!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
