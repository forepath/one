import type { LoadweaverClusterHealth } from './loadweaver.utils';

/**
 * One-time admin claim of a fresh cluster: `pending` (no account yet, the first registration needs the token),
 * `claimed` (the first account exists; token wiped from Decabill), `unknown` (cluster not reachable / no answer, or
 * an older cluster that doesn't report `claimConfigured`).
 */
export type LoadweaverAdminClaimStatus = 'pending' | 'claimed' | 'unknown';

/** Customer-facing view of a Decabill-provisioned Loadweaver cluster (service-detail tab "Cluster"). */
export interface LoadweaverClusterInfoResponseDto {
  itemId: string;
  /** `https://<fqdn>`: console on `/`, API on `/api`; null before a host name was reserved. */
  consoleUrl: string | null;
  apiUrl: string | null;
  /** One-line installer for further nodes (needs a join token from the console). */
  installerUrl: string | null;
  health: LoadweaverClusterHealth;
  checkedAt: string;
  /** Release the cluster was provisioned with (it updates itself afterwards). */
  initialVersion: string | null;
  /** Deep links into the cluster console for the steps before a cancellation. */
  links: {
    platformBackups: string | null;
    recoveryKit: string | null;
    nodes: string | null;
  };
  adminClaim: {
    status: LoadweaverAdminClaimStatus;
    /** The claim token; only for the owning customer and only until the cluster reports the claim done. */
    token: string | null;
  };
  teardown: {
    /** Days between the cancellation's effective date and the deletion of the Decabill-provisioned server. */
    graceDays: number;
    /** When the server may be deleted (pending cancellation only). */
    deletionNotBefore: string | null;
  };
}
