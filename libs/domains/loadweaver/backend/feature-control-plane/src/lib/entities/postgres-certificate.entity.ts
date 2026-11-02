import { createAes256GcmTransformer } from '@forepath/shared/backend';
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * A control-plane member's Postgres server certificate (3.2), issued from the cluster CA and reused for every push
 * while it still covers the member (CA, address) and has more than a third of its lifetime left. Stored so every
 * replica pushes the same certificate (byte-identical desired states) and so the renewal timer knows what is due.
 */
@Entity('lw_postgres_certificates')
export class PostgresCertificateEntity {
  @PrimaryColumn({ type: 'varchar', length: 63, name: 'node_name' })
  nodeName!: string;

  /** Hex serial of the certificate: a renewal only replaces the certificate it read (compare-and-swap). */
  @Column({ type: 'varchar', length: 64, name: 'serial' })
  serial!: string;

  /** The member address in the certificate's IP SANs. */
  @Column({ type: 'varchar', length: 45, name: 'address' })
  address!: string;

  @Column({ type: 'text', name: 'certificate_pem' })
  certificatePem!: string;

  @Column({ type: 'text', name: 'private_key', transformer: createAes256GcmTransformer() })
  privateKeyPem!: string;

  /** SHA-256 of the issuing CA certificate: another CA (re-keyed cluster) means a new certificate. */
  @Column({ type: 'varchar', length: 64, name: 'ca_fingerprint' })
  caFingerprint!: string;

  @Column({ type: 'timestamptz', name: 'not_before' })
  notBefore!: Date;

  @Column({ type: 'timestamptz', name: 'not_after' })
  notAfter!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
