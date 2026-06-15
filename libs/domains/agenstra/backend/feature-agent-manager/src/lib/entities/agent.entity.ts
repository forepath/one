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

  @Column({ type: 'varchar', length: 50, default: 'cursor', name: 'agent_type' })
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

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'git_repository_url' })
  gitRepositoryUrl?: string;

  @Column({ type: 'varchar', length: 16, nullable: true, name: 'git_repository_setup_mode' })
  gitRepositorySetupMode?: GitRepositorySetupMode;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
