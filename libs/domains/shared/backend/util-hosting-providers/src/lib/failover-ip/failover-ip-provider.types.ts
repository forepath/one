/** Identifies a server at its provider: the provider's id, or its name to look the id up. */
export interface ServerRef {
  id?: string;
  name?: string;
}

/**
 * A hosting provider's floating / failover IP API (3.6), for clusters whose addresses can't move by VRRP or BGP.
 * Instances are created per credential through a {@link FailoverIpProviderFactory}.
 */
export interface FailoverIpProvider {
  readonly id: string;
  /** Routes the address to the server; idempotent. */
  assign(address: string, server: ServerRef): Promise<void>;
  /** The provider id of the server the address currently points to, or null. */
  holder(address: string): Promise<string | null>;
}

export interface FailoverIpProviderFactory<C = Record<string, string>> {
  readonly id: string;
  readonly displayName: string;
  create(config: C): FailoverIpProvider;
}
