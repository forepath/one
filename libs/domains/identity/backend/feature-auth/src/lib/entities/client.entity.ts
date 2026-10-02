import { AuthenticationType, UserEntity } from '@forepath/identity/backend';
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
 * Client entity representing a client in the system.
 * Each client has a unique UUID identifier, name, description, and authentication config.
 */
@Entity('clients')
export class ClientEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 255, name: 'name' })
  name!: string;

  @Column({ type: 'text', nullable: true, name: 'description' })
  description?: string;

  @Column({ type: 'varchar', length: 255, name: 'endpoint' })
  endpoint!: string;

  @Column({ type: 'enum', enum: AuthenticationType, name: 'authentication_type' })
  authenticationType!: AuthenticationType;

  @Column({
    type: 'varchar',
    length: 1024,
    nullable: true,
    name: 'api_key',
    transformer: createAes256GcmTransformer(),
  })
  apiKey?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'keycloak_client_id' })
  keycloakClientId?: string;

  @Column({
    type: 'varchar',
    length: 1024,
    nullable: true,
    name: 'keycloak_client_secret',
    transformer: createAes256GcmTransformer(),
  })
  keycloakClientSecret?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'keycloak_realm' })
  keycloakRealm?: string;

  @Column({ type: 'uuid', nullable: true, name: 'user_id' })
  userId?: string;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  // Note: @OneToMany(() => ClientUserEntity) is NOT defined here because
  // ClientUserEntity in util-auth omits the inverse @ManyToOne(() => ClientEntity)
  // to avoid circular dependencies. Use ClientUsersRepository to query by clientId.

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
