import { createAes256GcmTransformer } from '@forepath/shared/backend';
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * A TLS certificate of the ingress (3.6): issued by the built-in ACME client or uploaded. The private key is stored
 * encrypted and only reaches ingress nodes at push time, never desired-state rows.
 */
@Entity('lw_certificates')
export class CertificateEntity {
  @PrimaryColumn({ type: 'varchar', length: 64, name: 'id' })
  id!: string;

  @Column({ type: 'jsonb', name: 'names' })
  names!: string[];

  @Column({ type: 'varchar', length: 16, name: 'source' })
  source!: 'acme' | 'custom';

  @Column({ type: 'text', name: 'certificate_pem', nullable: true })
  certificatePem!: string | null;

  @Column({ type: 'text', name: 'private_key', nullable: true, transformer: createAes256GcmTransformer() })
  privateKey!: string | null;

  @Column({ type: 'timestamptz', name: 'not_after', nullable: true })
  notAfter!: Date | null;

  /** ACME: consecutive failures and when to try again (exponential backoff). */
  @Column({ type: 'integer', name: 'failures', default: 0 })
  failures!: number;

  @Column({ type: 'timestamptz', name: 'next_attempt_at', nullable: true })
  nextAttemptAt!: Date | null;

  @Column({ type: 'varchar', length: 1000, name: 'last_error', nullable: true })
  lastError!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** The cluster's ACME account per directory. */
@Entity('lw_acme_accounts')
export class AcmeAccountEntity {
  @PrimaryColumn({ type: 'varchar', length: 512, name: 'directory' })
  directory!: string;

  @Column({ type: 'varchar', length: 1024, name: 'account_url' })
  accountUrl!: string;

  @Column({ type: 'text', name: 'private_key', transformer: createAes256GcmTransformer() })
  privateKey!: string;
}

/** A pending HTTP-01 answer, served by every ingress node until the order finished. */
@Entity('lw_acme_challenges')
export class AcmeChallengeEntity {
  @PrimaryColumn({ type: 'varchar', length: 128, name: 'token' })
  token!: string;

  @Column({ type: 'varchar', length: 256, name: 'key_authorization' })
  keyAuthorization!: string;

  @Column({ type: 'varchar', length: 253, name: 'name' })
  name!: string;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;
}
