import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * The built-in control-plane member (3.39): only its **public** seal key, so any replica can seal the holder's share /
 * standby copy and the console can show it. The private seal key lives in a file on the control-plane state volume and
 * is never written to the database. Not a node: it has no `lw_nodes` row, so nothing schedules onto it.
 */
@Entity('lw_builtin_members')
export class BuiltinMemberEntity {
  /** Always `control-plane`. */
  @PrimaryColumn({ type: 'varchar', length: 32, name: 'id' })
  id!: string;

  /** X25519 public key (base64). */
  @Column({ type: 'varchar', length: 64, name: 'seal_public_key' })
  sealPublicKey!: string;

  /** `auto` | `always` | `off`, as configured on the control plane that owns the key. */
  @Column({ type: 'varchar', length: 16, name: 'mode' })
  mode!: string;

  /** Host name of the control-plane container that registered / last saw the key. */
  @Column({ type: 'varchar', length: 255, name: 'instance', nullable: true })
  instance!: string | null;

  @Column({ type: 'timestamptz', name: 'last_seen_at', nullable: true })
  lastSeenAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
