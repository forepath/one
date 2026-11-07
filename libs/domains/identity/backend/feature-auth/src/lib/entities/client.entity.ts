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

  /** OAuth 2.0 client id used for the client credentials grant (authenticationType `oidc`). */
  @Column({ type: 'varchar', length: 255, nullable: true, name: 'oidc_client_id' })
  oidcClientId?: string;

  @Column({
    type: 'varchar',
    length: 1024,
    nullable: true,
    name: 'oidc_client_secret',
    transformer: createAes256GcmTransformer(),
  })
  oidcClientSecret?: string;

  /** Issuer of the OpenID provider; null → the controller's `OIDC_ISSUER`. */
  @Column({ type: 'varchar', length: 1024, nullable: true, name: 'oidc_issuer' })
  oidcIssuer?: string | null;

  /** Optional space separated scopes requested with the client credentials grant. */
  @Column({ type: 'varchar', length: 1024, nullable: true, name: 'oidc_scope' })
  oidcScope?: string | null;

  /** Client certificate chain (PEM, leaf first) for authenticationType `mtls`. Public data. */
  @Column({ type: 'text', nullable: true, name: 'mtls_certificate' })
  mtlsCertificate?: string | null;

  /** PKCS#8 / PKCS#1 / SEC1 private key (PEM) of {@link mtlsCertificate}; encrypted at rest. */
  @Column({ type: 'text', nullable: true, name: 'mtls_private_key', transformer: createAes256GcmTransformer() })
  mtlsPrivateKey?: string | null;

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
