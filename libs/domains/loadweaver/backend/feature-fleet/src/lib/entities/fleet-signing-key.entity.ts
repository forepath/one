import { createAes256GcmTransformer } from '@forepath/shared/backend';
import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** `next` (shown for registration), `active` (signs claims), `retired` (no longer signs). */
export type FleetSigningKeyState = 'next' | 'active' | 'retired';

/**
 * An Ed25519 key of the fleet's identity (3.24): it signs the per-request identity claims clusters verify with the
 * public key a cluster admin registered natively. The private key is sealed with `ENCRYPTION_KEY` like the
 * clusters' service credentials; the issuer id is the same for every key of this fleet.
 */
@Entity('lw_fleet_signing_keys')
export class FleetSigningKeyEntity {
  @PrimaryColumn({ type: 'varchar', length: 64, name: 'kid' })
  kid!: string;

  @Column({ type: 'varchar', length: 128, name: 'issuer' })
  issuer!: string;

  /** SPKI PEM. */
  @Column({ type: 'text', name: 'public_key' })
  publicKey!: string;

  /** PKCS#8 PEM, AES-256-GCM sealed; never returned by the API. */
  @Column({ type: 'text', name: 'private_key', transformer: createAes256GcmTransformer() })
  privateKey!: string;

  @Column({ type: 'varchar', length: 16, name: 'state' })
  state!: FleetSigningKeyState;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'activated_at', nullable: true })
  activatedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'retired_at', nullable: true })
  retiredAt!: Date | null;
}
