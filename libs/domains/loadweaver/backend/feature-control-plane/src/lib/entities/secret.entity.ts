import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One version of a project secret (3.22): envelope-encrypted with its own data key, wrapped by the cluster master
 * key. Values never appear in plans, logs or the audit log; only versions and fingerprints do.
 */
@Entity('lw_secrets')
@Index('IDX_lw_secrets_identity', ['project', 'name', 'version'], { unique: true })
export class SecretEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 63, name: 'project' })
  project!: string;

  @Column({ type: 'varchar', length: 128, name: 'name' })
  name!: string;

  @Column({ type: 'integer', name: 'version' })
  version!: number;

  @Column({ type: 'varchar', length: 16, name: 'key_id' })
  keyId!: string;

  @Column({ type: 'bytea', name: 'wrapped_key' })
  wrappedKey!: Buffer;

  @Column({ type: 'bytea', name: 'ciphertext' })
  ciphertext!: Buffer;

  /** Keyed hash of the value (HMAC with a master-key-derived key): shows changes without revealing values. */
  @Column({ type: 'varchar', length: 64, name: 'fingerprint' })
  fingerprint!: string;

  @Column({ type: 'varchar', length: 255, name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
