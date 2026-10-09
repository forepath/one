import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import type { FileNodeDto } from '../dto/file-node.dto';
import { AgentEntity } from './agent.entity';

@Entity('agent_directory_index')
@Index('IDX_agent_directory_index_agent_id', ['agentId'])
@Index('IDX_agent_directory_index_refreshed_at', ['refreshedAt'])
export class AgentDirectoryIndexEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ name: 'agent_id', type: 'uuid' })
  agentId!: string;

  @ManyToOne(() => AgentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agent_id' })
  agent!: AgentEntity;

  @Column({ name: 'container_id', type: 'text' })
  containerId!: string;

  @Column({ name: 'directory_path', type: 'text' })
  directoryPath!: string;

  @Column({ type: 'jsonb' })
  nodes!: FileNodeDto[];

  @Column({ name: 'refreshed_at', type: 'timestamptz' })
  refreshedAt!: Date;
}
