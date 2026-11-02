import { CONTINENTS, type Continent, type DnsFailoverSpec } from '@forepath/loadweaver/shared/util-model';

/**
 * DNS steering (3.28): per-client answers, decided by our engine and served by hosted bind9 through views. Weighted
 * splits clients by address bucket, geo by the client's country / continent (GeoIP), latency sends each continent to
 * the endpoint closest to it by probe measurements.
 */

/** Clients are split into this many address buckets (IPv4 /10s, IPv6 /13s of 2000::/3). */
export const STEERING_BUCKETS = 1024;
/** More views multiply bind9's memory per steered zone. */
export const MAX_VIEWS = 64;
/** Latency: a new endpoint must be this much faster before answers move (no flapping on jitter). */
const LATENCY_SWITCH_RATIO = 0.8;
const LATENCY_SWITCH_MIN_MS = 5;
/** Latency: a site counts as a vantage point for a continent within this distance of its centre. */
const VANTAGE_RADIUS_KM = 5_000;

/** Rough continent centres for picking the probing site that speaks for a continent. */
export const CONTINENT_CENTRES: Record<Continent, { latitude: number; longitude: number }> = {
  AF: { latitude: 2, longitude: 21 },
  AN: { latitude: -80, longitude: 0 },
  AS: { latitude: 34, longitude: 100 },
  EU: { latitude: 50, longitude: 10 },
  NA: { latitude: 45, longitude: -100 },
  OC: { latitude: -25, longitude: 140 },
  SA: { latitude: -15, longitude: -60 },
};

/** The networks of a bucket: one IPv4 /10 and one IPv6 /13 inside 2000::/3. */
export function bucketNetworks(bucket: number): [string, string] {
  const v4 = (bucket << 22) >>> 0;
  const v6 = 0x2000 | (bucket << 3);

  return [`${v4 >>> 24}.${(v4 >>> 16) & 0xff}.0.0/10`, `${v6.toString(16)}::/13`];
}

/**
 * Bucket → endpoint by weight: a smooth weighted round robin over consecutive buckets, so every endpoint's share is
 * interleaved across the whole address space rather than one contiguous range.
 */
export function weightedBuckets(endpoints: readonly { name: string; weight: number }[]): string[] {
  const usable = [...endpoints].filter((e) => e.weight > 0).sort((a, b) => a.name.localeCompare(b.name));
  const total = usable.reduce((sum, e) => sum + e.weight, 0);
  const current = new Map(usable.map((e) => [e.name, 0]));
  const buckets = new Array<string>(STEERING_BUCKETS);

  if (usable.length === 0) return [];

  for (let position = 0; position < STEERING_BUCKETS; position++) {
    let best = usable[0];

    for (const e of usable) {
      current.set(e.name, (current.get(e.name) ?? 0) + e.weight);

      if ((current.get(e.name) ?? 0) > (current.get(best.name) ?? 0)) best = e;
    }

    current.set(best.name, (current.get(best.name) ?? 0) - total);
    buckets[position] = best.name;
  }

  return buckets;
}

export interface LatencyChoice {
  /** For clients of continents without a vantage point. */
  default?: string;
  byContinent: Partial<Record<Continent, string>>;
}

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;

  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Keeps the previous choice unless the best is clearly faster. */
function withHysteresis(
  latencyOf: (endpoint: string) => number | undefined,
  candidates: readonly string[],
  previous: string | undefined,
): string | undefined {
  const measured = candidates.filter((c) => latencyOf(c) !== undefined);

  if (measured.length === 0) return previous && candidates.includes(previous) ? previous : undefined;

  const best = measured.reduce((a, b) => ((latencyOf(b) as number) < (latencyOf(a) as number) ? b : a));
  const prev = previous && measured.includes(previous) ? previous : undefined;

  if (!prev || prev === best) return best;

  const was = latencyOf(prev) as number;
  const now = latencyOf(best) as number;

  return now <= was * LATENCY_SWITCH_RATIO && was - now >= LATENCY_SWITCH_MIN_MS ? best : prev;
}

/**
 * Latency steering: per continent, the probing site nearest to its centre speaks for its clients and the healthy
 * endpoint it measures fastest answers them; everyone else gets the endpoint fastest on average.
 */
export function chooseLatency(
  healthy: readonly string[],
  latency: ReadonlyMap<string, ReadonlyMap<string, number>>,
  sites: ReadonlyMap<string, { latitude: number; longitude: number }>,
  previous: LatencyChoice | undefined,
): LatencyChoice {
  const average = (endpoint: string) => {
    const values = [...(latency.get(endpoint)?.values() ?? [])];

    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
  };
  const measuredSites = new Set([...latency.values()].flatMap((m) => [...m.keys()]));
  const byContinent: Partial<Record<Continent, string>> = {};

  for (const continent of CONTINENTS) {
    const vantage = [...sites]
      .filter(([site]) => measuredSites.has(site))
      .map(([site, location]) => ({ site, km: distanceKm(location, CONTINENT_CENTRES[continent]) }))
      .filter((v) => v.km <= VANTAGE_RADIUS_KM)
      .sort((a, b) => a.km - b.km)[0];

    if (!vantage) continue;

    const choice = withHysteresis(
      (endpoint) => latency.get(endpoint)?.get(vantage.site),
      healthy,
      previous?.byContinent[continent],
    );

    if (choice) byContinent[continent] = choice;
  }

  const fallback = withHysteresis(average, healthy, previous?.default);

  return { ...(fallback ? { default: fallback } : {}), byContinent };
}

export interface Steering {
  /** `country:DE` / `continent:EU` → addresses. */
  geo: Map<string, string[]>;
  /** Addresses per bucket ({@link STEERING_BUCKETS}), weighted only. */
  buckets?: string[][];
}

/**
 * What a steered failover answers: `addresses` is the default (all API providers, clients no view matches),
 * `steering` the per-client variants for hosted bind9. Unhealthy endpoints are out of every answer.
 */
export function steer(
  spec: DnsFailoverSpec,
  healthy: readonly string[],
  latency: LatencyChoice | undefined,
): { addresses: string[]; steering?: Steering } {
  const live = spec.endpoints.filter((e) => healthy.includes(e.name));
  const all = (live.length > 0 ? live : spec.endpoints).map((e) => e.address);
  const address = (name: string | undefined) => spec.endpoints.find((e) => e.name === name)?.address;

  if (spec.mode === 'weighted') {
    const weighted = live.filter((e) => (e.weight ?? 1) > 0);
    const buckets = weightedBuckets(weighted.map((e) => ({ name: e.name, weight: e.weight ?? 1 })));

    return {
      addresses: weighted.length > 0 ? weighted.map((e) => e.address) : all,
      ...(weighted.length > 1
        ? { steering: { geo: new Map(), buckets: buckets.map((name) => [address(name) as string]) } }
        : {}),
    };
  }

  if (spec.mode === 'geo') {
    const geo = new Map<string, string[]>();

    for (const e of live) {
      for (const key of [
        ...(e.countries ?? []).map((c) => `country:${c}`),
        ...(e.continents ?? []).map((c) => `continent:${c}`),
      ])
        geo.set(key, [...(geo.get(key) ?? []), e.address].sort());
    }

    const unregioned = live.filter((e) => !e.countries?.length && !e.continents?.length).map((e) => e.address);

    return { addresses: unregioned.length > 0 ? unregioned : all, ...(geo.size > 0 ? { steering: { geo } } : {}) };
  }

  if (spec.mode === 'latency') {
    const geo = new Map<string, string[]>();

    for (const [continent, endpoint] of Object.entries(latency?.byContinent ?? {})) {
      const a = address(endpoint);

      if (a && healthy.includes(endpoint as string)) geo.set(`continent:${continent}`, [a]);
    }

    const fallback = latency?.default && healthy.includes(latency.default) ? address(latency.default) : undefined;

    return { addresses: fallback ? [fallback] : all, ...(geo.size > 0 ? { steering: { geo } } : {}) };
  }

  return { addresses: all };
}

export interface SteeredHost {
  zone: string;
  fqdn: string;
  addresses: string[];
  steering: Steering;
}

export interface SteeringView {
  /** `lw-<n>`, in match order. */
  name: string;
  country?: string;
  continent?: Continent;
  networks?: string[];
  /** Answer per steered host in this view. */
  answers: Map<string, string[]>;
}

/**
 * The views hosted bind9 needs: every combination of the countries, continents and bucket groups the steered hosts
 * use, most specific first (bind matches the first view). Combinations that can't occur (a country on another
 * continent) never match and cost nothing but a view; the default answers live in the default view after these.
 */
export function steeringViews(hosts: readonly SteeredHost[], geo: boolean): SteeringView[] | { error: string } {
  const keys = new Set(geo ? hosts.flatMap((h) => [...h.steering.geo.keys()]) : []);
  const countries = [...keys]
    .filter((k) => k.startsWith('country:'))
    .map((k) => k.slice(8))
    .sort();
  const continents = [...keys]
    .filter((k) => k.startsWith('continent:'))
    .map((k) => k.slice(10) as Continent)
    .sort();
  // Buckets with the same answers for every weighted host form one group.
  const weighted = hosts.filter((h) => h.steering.buckets);
  const groups = new Map<string, number[]>();

  if (weighted.length > 0) {
    for (let b = 0; b < STEERING_BUCKETS; b++) {
      const key = weighted.map((h) => h.steering.buckets?.[b]?.join(',')).join('|');

      groups.set(key, [...(groups.get(key) ?? []), b]);
    }
  }

  const bucketGroups = [...groups.values()];
  const combos: { country?: string; continent?: Continent; group?: number[] }[] = [];

  for (const country of [...countries, undefined]) {
    for (const continent of [...continents, undefined]) {
      for (const group of bucketGroups.length > 0 ? [...bucketGroups, undefined] : [undefined]) {
        if (country === undefined && continent === undefined && group === undefined) continue;

        combos.push({
          ...(country ? { country } : {}),
          ...(continent ? { continent } : {}),
          ...(group ? { group } : {}),
        });
      }
    }
  }

  if (combos.length > MAX_VIEWS)
    return { error: `DNS steering needs ${combos.length} bind9 views, at most ${MAX_VIEWS} are supported` };

  return combos.map((combo, i) => {
    const answers = new Map<string, string[]>();

    for (const host of hosts) {
      const bucket = combo.group && host.steering.buckets ? host.steering.buckets[combo.group[0]] : undefined;
      const answer =
        bucket ??
        (combo.country ? host.steering.geo.get(`country:${combo.country}`) : undefined) ??
        (combo.continent ? host.steering.geo.get(`continent:${combo.continent}`) : undefined) ??
        host.addresses;

      answers.set(host.fqdn, answer);
    }

    return {
      name: `lw-${i + 1}`,
      ...(combo.country ? { country: combo.country } : {}),
      ...(combo.continent ? { continent: combo.continent } : {}),
      ...(combo.group ? { networks: combo.group.flatMap((b) => bucketNetworks(b)) } : {}),
      answers,
    };
  });
}
