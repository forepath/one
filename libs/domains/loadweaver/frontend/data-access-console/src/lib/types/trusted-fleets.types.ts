/** A key of a trusted fleet (3.24): Ed25519, SPKI PEM, with the fingerprint the fleet shows, too. */
export interface TrustedFleetKey {
  kid: string;
  publicKey: string;
  addedAt: string;
  fingerprint: string;
}

/** A fleet whose identity claims the cluster accepts (approvals through the fleet, 3.24). */
export interface TrustedFleet {
  issuer: string;
  name: string;
  keys: TrustedFleetKey[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TrustedFleetInput {
  name: string;
  keys: { kid: string; publicKey: string }[];
}
