import { familyBits, formatIp, parseIp, type IpAddress, type IpFamily } from './ip';

/* BigInt constants instead of literals, so consumers compiled for older targets still build. */
const B_0 = BigInt(0);
const B_1 = BigInt(1);

export interface Cidr {
  family: IpFamily;
  /** Network address (host bits cleared). */
  network: bigint;
  prefixLength: number;
}

function hostMask(family: IpFamily, prefixLength: number): bigint {
  return (B_1 << BigInt(familyBits(family) - prefixLength)) - B_1;
}

/**
 * Parses `addr/len`. With `strict` (default) host bits must be zero, so `10.0.0.1/24` is rejected:
 * a policy that names a network should name it exactly.
 */
export function parseCidr(input: string, strict = true): Cidr | null {
  const slash = input.indexOf('/');

  if (slash < 0) return null;

  const ip = parseIp(input.slice(0, slash));
  const lenText = input.slice(slash + 1);

  if (!ip || !/^(0|[1-9][0-9]{0,2})$/.test(lenText)) return null;

  const prefixLength = Number(lenText);

  if (prefixLength > familyBits(ip.family)) return null;

  const mask = hostMask(ip.family, prefixLength);

  if (strict && (ip.value & mask) !== B_0) return null;

  return { family: ip.family, network: ip.value & ~mask, prefixLength };
}

export function mustParseCidr(input: string, strict = true): Cidr {
  const cidr = parseCidr(input, strict);

  if (!cidr) throw new Error(`invalid CIDR: ${input}`);

  return cidr;
}

export function isCidr(input: string): boolean {
  return parseCidr(input) !== null;
}

export function formatCidr(cidr: Cidr): string {
  return `${formatIp({ family: cidr.family, value: cidr.network })}/${cidr.prefixLength}`;
}

export function cidrSize(cidr: Cidr): bigint {
  return B_1 << BigInt(familyBits(cidr.family) - cidr.prefixLength);
}

export function cidrLast(cidr: Cidr): bigint {
  return cidr.network + cidrSize(cidr) - B_1;
}

export function cidrContainsIp(cidr: Cidr, ip: IpAddress): boolean {
  return cidr.family === ip.family && ip.value >= cidr.network && ip.value <= cidrLast(cidr);
}

/** `outer` fully contains `inner` (same family, equal or longer prefix). */
export function cidrContains(outer: Cidr, inner: Cidr): boolean {
  return (
    outer.family === inner.family &&
    inner.prefixLength >= outer.prefixLength &&
    inner.network >= outer.network &&
    cidrLast(inner) <= cidrLast(outer)
  );
}

export function cidrOverlaps(a: Cidr, b: Cidr): boolean {
  return a.family === b.family && a.network <= cidrLast(b) && b.network <= cidrLast(a);
}

/** The n-th address inside the prefix (0 = network address). */
export function cidrAddress(cidr: Cidr, offset: bigint): IpAddress {
  if (offset < B_0 || offset >= cidrSize(cidr)) throw new RangeError('offset outside prefix');

  return { family: cidr.family, value: cidr.network + offset };
}

/** Host route for a single address (/32 or /128). */
export function hostCidr(ip: IpAddress): Cidr {
  return { family: ip.family, network: ip.value, prefixLength: familyBits(ip.family) };
}

/**
 * Finds the lowest free sub-prefix of `prefixLength` inside `pool` that does not overlap any of `used`.
 * Deterministic so plans are reproducible. Returns null when the pool is exhausted.
 */
export function allocateSubnet(pool: Cidr, prefixLength: number, used: readonly Cidr[]): Cidr | null {
  if (prefixLength < pool.prefixLength || prefixLength > familyBits(pool.family)) {
    throw new RangeError('requested prefix does not fit into the pool');
  }

  const step = B_1 << BigInt(familyBits(pool.family) - prefixLength);
  const relevant = used
    .filter((c) => cidrOverlaps(c, pool))
    .sort((a, b) => (a.network < b.network ? -1 : a.network > b.network ? 1 : 0));
  const last = cidrLast(pool);
  let candidate = pool.network;

  while (candidate + step - B_1 <= last) {
    const probe: Cidr = { family: pool.family, network: candidate, prefixLength };
    const blocker = relevant.find((c) => cidrOverlaps(c, probe));

    if (!blocker) return probe;

    // Skip past the blocker, aligned to the step.
    const next = cidrLast(blocker) + B_1;

    candidate = ((next + step - B_1) / step) * step;
  }

  return null;
}

/**
 * Finds the lowest free single address in `pool`, skipping `reserved` offsets at the start
 * (e.g. network address and gateway) and any address in `used`.
 */
export function allocateAddress(pool: Cidr, used: readonly IpAddress[], reservedLeading = B_0): IpAddress | null {
  const taken = new Set(used.filter((ip) => cidrContainsIp(pool, ip)).map((ip) => ip.value));
  const size = cidrSize(pool);
  // IPv4 pools keep the broadcast address free.
  const end = pool.family === 4 && pool.prefixLength < 31 ? size - B_1 : size;

  for (let offset = reservedLeading; offset < end; offset++) {
    const value = pool.network + offset;

    if (!taken.has(value)) return { family: pool.family, value };
  }

  return null;
}
