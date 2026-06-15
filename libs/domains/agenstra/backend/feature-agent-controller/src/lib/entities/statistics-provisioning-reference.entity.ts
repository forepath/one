import { createAes256GcmTransformer } from '@forepath/shared/backend';
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

import { StatisticsClientEntity } from './statistics-client.entity';

/**
 * Shadow table for provisioning references. Stores references to original
 * provisioning references for statistics correlation. provider_metadata is
 * sanitized (no secrets) and encrypted.
 */
@Entity('statistics_provisioning_references')
@Index('IDX_statistics_provisioning_refs_original_id', ['originalProvisioningReferenceId'], { unique: true })
@Index('IDX_statistics_provisioning_refs_statistics_client_id', ['statisticsClientId'])
export class StatisticsProvisioningReferenceEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'original_provisioning_reference_id' })
  originalProvisioningReferenceId!: string;

  @Column({ type: 'uuid', name: 'statistics_client_id' })
  statisticsClientId!: string;

  @ManyToOne(() => StatisticsClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'statistics_client_id' })
  statisticsClient?: StatisticsClientEntity;

  @Column({ type: 'varchar', length: 50, name: 'provider_type' })
  providerType!: string;

  @Column({ type: 'varchar', length: 255, name: 'server_id' })
  serverId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'server_name' })
  serverName?: string;

  @Column({ type: 'varchar', length: 45, nullable: true, name: 'public_ip' })
  publicIp?: string;

  @Column({ type: 'varchar', length: 45, nullable: true, name: 'private_ip' })
  privateIp?: string;

  @Column({
    type: 'text',
    nullable: true,
    name: 'provider_metadata',
    transformer: createAes256GcmTransformer(),
  })
  providerMetadata?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
