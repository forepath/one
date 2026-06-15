import { AuthenticationType } from '@forepath/identity/backend';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Shadow table for clients. Stores references to original clients for statistics
 * correlation. Does not contain secrets (api_key, keycloak_client_secret).
 */
@Entity('statistics_clients')
@Index('IDX_statistics_clients_original_client_id', ['originalClientId'], { unique: true })
export class StatisticsClientEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'original_client_id' })
  originalClientId!: string;

  @Column({ type: 'varchar', length: 255, name: 'name' })
  name!: string;

  @Column({ type: 'varchar', length: 255, name: 'endpoint' })
  endpoint!: string;

  @Column({ type: 'enum', enum: AuthenticationType, name: 'authentication_type' })
  authenticationType!: AuthenticationType;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
