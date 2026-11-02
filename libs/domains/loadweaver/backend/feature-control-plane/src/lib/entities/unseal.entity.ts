import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** A replica asking share holders for their shares, re-encrypted to its ephemeral key (3.22). */
@Entity('lw_unseal_requests')
export class UnsealRequestEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 16, name: 'key_id' })
  keyId!: string;

  @Column({ type: 'varchar', length: 64, name: 'requester_public_key' })
  requesterPublicKey!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

/** A share sealed to a requester's ephemeral key; useless to anyone else. */
@Entity('lw_unseal_shares')
export class UnsealShareEntity {
  @PrimaryColumn({ type: 'uuid', name: 'request_id' })
  requestId!: string;

  @PrimaryColumn({ type: 'varchar', length: 63, name: 'node' })
  node!: string;

  @Column({ type: 'text', name: 'sealed_share' })
  sealedShare!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
