import { ClientEntity } from '@forepath/identity/backend';
import { createAes256GcmTransformer } from '@forepath/shared/backend';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Entity representing a provisioning reference for a client.
 * Links a client to a cloud provider server instance.
 */
@Entity('provisioning_references')
export class ProvisioningReferenceEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @ManyToOne(() => ClientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client!: ClientEntity;

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

  // Stored encrypted at rest (AES-256-GCM). Decrypted transparently via transformer.
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
