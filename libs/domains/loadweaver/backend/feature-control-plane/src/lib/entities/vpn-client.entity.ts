import { createAes256GcmTransformer } from '@forepath/shared/backend';
import { Column, CreateDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

/** Core posture checks a client reports (3.31); plugins (MDM / EDR) add their verdicts. */
export interface PostureReport {
  platform: 'macos' | 'windows' | 'linux' | 'ios' | 'android';
  osVersion: string;
  appVersion?: string;
  diskEncryption?: boolean;
  firewall?: boolean;
  screenLock?: boolean;
  /** MDM / EDR device id or serial, so plugins can look the device up. */
  deviceId?: string;
}

export interface PostureState {
  report: PostureReport | null;
  reportedAt: string | null;
  /** Plugin verdicts by plugin type, at the time of the report. */
  plugins: Record<string, { verdict: string; detail?: string }>;
  /** Groups the device fails, with the reasons shown to the user. */
  failing: Record<string, string[]>;
  /** MDM / EDR device id, pinned once a plugin knew it: later reports can't borrow another device's compliance. */
  deviceId?: string;
}

/**
 * A remote access client (3.31): a user's device (self-service, public key generated on the device) or a machine
 * (CI runner, server, office router) enrolled by an admin. Keys expire; revocation is instant.
 */
@Entity('lw_vpn_clients')
export class VpnClientEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 16, name: 'kind' })
  kind!: 'user' | 'machine';

  /** Device or machine name (`laptop`, `office-berlin`). */
  @Column({ type: 'varchar', length: 63, name: 'name' })
  name!: string;

  /** Owner of a user device. */
  @Column({ type: 'varchar', length: 255, name: 'user_id', nullable: true })
  userId!: string | null;

  /** Shown in logs and on the map (`alice@example.com`); for machines `machine`. */
  @Column({ type: 'varchar', length: 255, name: 'owner_label' })
  ownerLabel!: string;

  @Column({ type: 'varchar', length: 44, name: 'public_key', unique: true })
  publicKey!: string;

  /** Unique among current clients; reused after a revoked / expired client's grace period. */
  @Column({ type: 'varchar', length: 45, name: 'address' })
  address!: string;

  /** Office networks behind a machine client (site-to-site). */
  @Column({ type: 'text', array: true, name: 'subnets', default: () => "'{}'" })
  subnets!: string[];

  /** Client groups: the user's identity-provider groups at enrollment / renewal, or assigned for machines. */
  @Column({ type: 'text', array: true, name: 'groups', default: () => "'{}'" })
  groups!: string[];

  @Column({ type: 'jsonb', name: 'posture', nullable: true })
  posture!: PostureState | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'renewed_at' })
  renewedAt!: Date;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', name: 'revoked_at', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'last_handshake_at', nullable: true })
  lastHandshakeAt!: Date | null;

  @Column({ type: 'varchar', length: 64, name: 'last_endpoint', nullable: true })
  lastEndpoint!: string | null;

  @Column({ type: 'varchar', length: 63, name: 'last_gateway', nullable: true })
  lastGateway!: string | null;
}

/** The gateways' shared WireGuard key (3.31): one public key for every client config, reaching nodes at push time. */
@Entity('lw_vpn_gateway_keys')
export class VpnGatewayKeyEntity {
  @PrimaryColumn({ type: 'varchar', length: 16, name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 44, name: 'public_key' })
  publicKey!: string;

  @Column({ type: 'text', name: 'private_key', transformer: createAes256GcmTransformer() })
  privateKey!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
