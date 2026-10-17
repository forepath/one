import { cidrOverlaps, parseCidr } from '@forepath/loadweaver/shared/util-network';

/**
 * Per-source egress settings for agents without the `egress-policies` feature (M6 review M5). Such agents don't know
 * `network.egressFilter.sources[].mode / blockPrivateNetworks / blockIpLiterals / logAllowed / denyUrlRegexes /
 * denyCidrs` (the version gates strip them), so before stripping the control plane folds them into what the agent
 * does know, never looser than the source's own settings:
 *
 * - a stricter per-source mode raises the node-level mode (an `offline` source additionally loses its allow lists:
 *   with the node enforcing, nothing of its web egress passes);
 * - per-source `blockPrivateNetworks` / `blockIpLiterals` / `logAllowed` switch the node-level setting on;
 * - enforced `denyCidrs` remove the allow-list CIDRs they overlap.
 *
 * What can't be expressed that way (URL deny patterns; address denies of a source without an allow list) is returned
 * as `unexpressible`, for the control plane to warn about.
 */

type Mode = 'monitor' | 'enforce' | 'offline';

const MODE_RANK: Record<Mode, number> = { monitor: 0, enforce: 1, offline: 2 };

interface LegacySource {
  address: string;
  allow: unknown[];
  allowCidrs: string[];
  unrestricted: boolean;
  mode?: Mode;
  blockPrivateNetworks?: boolean;
  blockIpLiterals?: boolean;
  logAllowed?: boolean;
  denyUrlRegexes?: string[];
  denyCidrs?: { cidr: string; monitor: boolean }[];
  [key: string]: unknown;
}

interface LegacyFilter {
  mode: Mode;
  blockPrivateNetworks: boolean;
  blockIpLiterals: boolean;
  logAllowed: boolean;
  sources: LegacySource[];
  [key: string]: unknown;
}

export interface UnexpressibleEgressSetting {
  address: string;
  setting: 'denyUrlRegexes' | 'denyCidrs';
}

function overlaps(a: string, b: string): boolean {
  const x = parseCidr(a, false);
  const y = parseCidr(b, false);

  // Unparsable entries are treated as overlapping (removed): never looser.
  return !x || !y || (x.family === y.family && cidrOverlaps(x, y));
}

export function foldEgressPoliciesForLegacy<F extends LegacyFilter>(
  filter: F,
): { filter: F; unexpressible: UnexpressibleEgressSetting[] } {
  const unexpressible: UnexpressibleEgressSetting[] = [];
  let mode = filter.mode;
  let blockPrivateNetworks = filter.blockPrivateNetworks;
  let blockIpLiterals = filter.blockIpLiterals;
  let logAllowed = filter.logAllowed;

  const sources = filter.sources.map((source) => {
    let next = source;

    // Anything stricter than the node level makes the node enforce (offline sources lose their allow lists below).
    if (source.mode && MODE_RANK[source.mode] > MODE_RANK[mode]) mode = 'enforce';

    if (source.mode === 'offline') next = { ...next, allow: [], allowCidrs: [], unrestricted: false };

    blockPrivateNetworks ||= source.blockPrivateNetworks === true;
    blockIpLiterals ||= source.blockIpLiterals === true;
    logAllowed ||= source.logAllowed === true;

    const denies = (source.denyCidrs ?? []).filter((d) => !d.monitor).map((d) => d.cidr);

    if (denies.length > 0 && source.mode !== 'offline') {
      next = { ...next, allowCidrs: next.allowCidrs.filter((c) => !denies.some((d) => overlaps(c, d))) };

      if (next.unrestricted) unexpressible.push({ address: source.address, setting: 'denyCidrs' });
    }

    if ((source.denyUrlRegexes ?? []).length > 0 && source.mode !== 'offline')
      unexpressible.push({ address: source.address, setting: 'denyUrlRegexes' });

    return next;
  });

  return {
    filter: { ...filter, mode, blockPrivateNetworks, blockIpLiterals, logAllowed, sources },
    unexpressible,
  };
}

/** `foldEgressPoliciesForLegacy` on a desired-state payload (its `network.egressFilter`); other payloads unchanged. */
export function foldDesiredStateEgressForLegacy(payload: unknown): unknown {
  const network = (payload as { network?: { egressFilter?: LegacyFilter } } | null)?.network;

  if (!network?.egressFilter?.sources?.length) return payload;

  const { filter } = foldEgressPoliciesForLegacy(network.egressFilter);

  return {
    ...(payload as Record<string, unknown>),
    network: { ...network, egressFilter: filter },
  };
}
