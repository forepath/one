/** A DS record as the parent zone publishes it (RFC 4034 section 5). */
export interface RegistrarDsRecord {
  keyTag: number;
  algorithm: number;
  digestType: number;
  /** Hex digest. */
  digest: string;
}

/**
 * A domain registrar account (3.15): publishes the DS records of a DNSSEC-signed zone at the parent, so key
 * rollovers need no manual step. Registrars come as dynamic provider plugins.
 */
export interface RegistrarProvider {
  readonly id: string;
  /** The DS records currently registered for the domain. */
  listDs(domain: string): Promise<RegistrarDsRecord[]>;
  /** Replaces the domain's DS records with exactly these. */
  setDs(domain: string, records: RegistrarDsRecord[]): Promise<void>;
}

export interface RegistrarProviderFactory<C = Record<string, string>> {
  readonly id: string;
  readonly displayName: string;
  create(config: C): RegistrarProvider;
}
