import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** One registered public key of a trusted fleet (Ed25519, SPKI PEM). */
export interface TrustedFleetKey {
  kid: string;
  publicKey: string;
  addedAt: string;
}

/**
 * A fleet whose identity claims this cluster accepts (3.24): registered natively by a cluster admin (never through a
 * fleet), with up to three keys so a fleet can rotate (`kid`).
 */
@Entity('lw_trusted_fleets')
export class TrustedFleetEntity {
  @PrimaryColumn({ type: 'varchar', length: 128, name: 'issuer' })
  issuer!: string;

  @Column({ type: 'varchar', length: 255, name: 'name' })
  name!: string;

  @Column({ type: 'jsonb', name: 'keys', default: () => "'[]'::jsonb" })
  keys!: TrustedFleetKey[];

  /**
   * The fleet's app catalog (P1): where it is served (`https://<fleet>`, matched against `type: fleet` catalog sources
   * by origin) and the public keys (ECDSA P-256 / Ed25519, PEM) its signed index and packages verify with.
   */
  @Column({ type: 'jsonb', name: 'catalog', nullable: true })
  catalog!: TrustedFleetCatalog | null;

  @Column({ type: 'varchar', length: 255, name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}

/** The app catalog a trusted fleet hosts (P1). */
export interface TrustedFleetCatalog {
  url: string;
  publicKeys: string[];
  /**
   * Name of the fixed app store entry (2026-11-01): the fleet's `FLEET_CATALOG_NAME`, else derived from the fleet's
   * name / issuer; pinned with the first registration of the catalog (renaming the fleet doesn't change it).
   * Absent on registrations stored before.
   */
  name?: string;
}

/**
 * A person who acted through a trusted fleet (`fleet:<iss>:<sub>`), with the email the fleet vouched for: the
 * two-person rules treat the same verified email as the same person (exclusion only).
 */
@Entity('lw_fleet_persons')
export class FleetPersonEntity {
  @PrimaryColumn({ type: 'varchar', length: 255, name: 'person_id' })
  personId!: string;

  @Column({ type: 'varchar', length: 128, name: 'issuer' })
  issuer!: string;

  @Column({ type: 'varchar', length: 128, name: 'subject' })
  subject!: string;

  @Column({ type: 'varchar', length: 320, name: 'email', nullable: true })
  email!: string | null;

  @Column({ type: 'boolean', name: 'email_verified', default: false })
  emailVerified!: boolean;

  @Column({ type: 'timestamptz', name: 'last_seen_at' })
  lastSeenAt!: Date;
}

export const FLEET_IDENTITY_ENTITIES = [TrustedFleetEntity, FleetPersonEntity];
