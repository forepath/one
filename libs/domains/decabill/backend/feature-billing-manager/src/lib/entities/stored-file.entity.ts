import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('billing_stored_files')
@Index('UQ_billing_stored_files_scope_key', ['scope', 'storageKey'], { unique: true })
@Index('IDX_billing_stored_files_long_sha', ['longSha'])
@Index('IDX_billing_stored_files_content_sha256', ['contentSha256'])
export class StoredFileEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 40, name: 'long_sha' })
  longSha!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id' })
  tenantId!: string;

  /** FileStorageScope value (e.g. customerInvoices). */
  @Column({ type: 'varchar', length: 64, name: 'scope' })
  scope!: string;

  @Column({ type: 'varchar', length: 512, name: 'storage_key' })
  storageKey!: string;

  @Column({ type: 'varchar', length: 32, nullable: true, name: 'content_md5' })
  contentMd5?: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true, name: 'content_sha1' })
  contentSha1?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'content_sha256' })
  contentSha256?: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true, name: 'content_sha512' })
  contentSha512?: string | null;

  @Column({ type: 'bigint', nullable: true, name: 'byte_size' })
  byteSize?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'signature' })
  signature?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true, name: 'signature_alg' })
  signatureAlg?: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true, name: 'signature_version' })
  signatureVersion?: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'signed_at' })
  signedAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
