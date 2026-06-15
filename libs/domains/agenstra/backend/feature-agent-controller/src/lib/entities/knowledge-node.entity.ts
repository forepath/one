import { createHash } from 'crypto';

import { ClientEntity } from '@forepath/identity/backend';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { KnowledgeNodeType } from './knowledge-node.enums';

@Entity('knowledge_nodes')
@Check(`"node_type" <> 'page' OR "parent_id" IS NOT NULL OR "parent_id" IS NULL`)
export class KnowledgeNodeEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @ManyToOne(() => ClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client!: ClientEntity;

  @Column({
    type: 'enum',
    enum: KnowledgeNodeType,
    enumName: 'knowledge_node_type_enum',
    name: 'node_type',
  })
  nodeType!: KnowledgeNodeType;

  @Column({ type: 'uuid', nullable: true, name: 'parent_id' })
  parentId?: string | null;

  @ManyToOne(() => KnowledgeNodeEntity, (n) => n.children, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_id' })
  parent?: KnowledgeNodeEntity | null;

  @OneToMany(() => KnowledgeNodeEntity, (n) => n.parent)
  children!: KnowledgeNodeEntity[];

  @Column({ type: 'varchar', length: 500, name: 'title' })
  title!: string;

  @Column({ type: 'text', nullable: true, name: 'content' })
  content?: string | null;

  @Column({ type: 'int', name: 'sort_order', default: 0 })
  sortOrder!: number;

  @Column({ type: 'varchar', length: 40, nullable: true, name: 'long_sha' })
  longSha?: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  static deriveLongSha(nodeId: string): string {
    return createHash('sha1').update(nodeId).digest('hex');
  }
}
