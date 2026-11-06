import * as net from 'node:net';

/**
 * Non-public IPv4 space (IANA special-purpose registry): "this network" (0.0.0.0/8 — connecting to 0.0.0.0 reaches the
 * local host), private, CGNAT (incl. cloud metadata such as 100.100.100.200), loopback, link-local (incl.
 * 169.254.169.254), IETF protocol assignments, 6to4 relay anycast, benchmarking, multicast and reserved.
 * Documentation ranges (RFC 5737 / 3849) are not routed on the internet and stay unclassified.
 */
const BLOCKED_IPV4: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];
/** Non-public IPv6 space: unspecified, loopback, discard, ULA, link-local, site-local, multicast. */
const BLOCKED_IPV6: ReadonlyArray<readonly [string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['100::', 64],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
];
const blockList = new net.BlockList();

for (const [address, prefix] of BLOCKED_IPV4) {
  blockList.addSubnet(address, prefix, 'ipv4');
}

for (const [address, prefix] of BLOCKED_IPV6) {
  blockList.addSubnet(address, prefix, 'ipv6');
}

/** Removes URL brackets (`[::1]`) and an IPv6 zone id (`fe80::1%eth0`). */
function normalizeIpLiteral(ip: string): string {
  let value = ip.trim();

  if (value.startsWith('[') && value.endsWith(']')) {
    value = value.slice(1, -1);
  }

  const zone = value.indexOf('%');

  return zone >= 0 ? value.slice(0, zone) : value;
}

/** Expands an IPv6 address into its 8 hextets (handles `::` and a trailing dotted IPv4 part). */
function expandIpv6(ip: string): number[] | null {
  let value = ip.toLowerCase();
  const lastColon = value.lastIndexOf(':');
  const lastPart = value.slice(lastColon + 1);

  if (net.isIPv4(lastPart)) {
    const [a, b, c, d] = lastPart.split('.').map(Number);

    value = `${value.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = value.split('::');

  if (halves.length > 2) {
    return null;
  }

  const parse = (part: string) => (part.length === 0 ? [] : part.split(':').map((h) => parseInt(h, 16)));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;

  if (fill < 0) {
    return null;
  }

  const hextets = [...head, ...new Array(fill).fill(0), ...tail];

  return hextets.length === 8 && hextets.every((h) => Number.isInteger(h) && h >= 0 && h <= 0xffff) ? hextets : null;
}

function ipv4FromHextets(high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/**
 * IPv4 addresses embedded in IPv6 that route to (or are translated into) the embedded IPv4: IPv4-mapped
 * (`::ffff:a.b.c.d`, also in hex form), IPv4-compatible (`::a.b.c.d`), NAT64 (`64:ff9b::/96`), 6to4 (`2002::/16`)
 * and Teredo (`2001::/32`, client address obfuscated).
 */
function embeddedIpv4(hextets: number[]): string | null {
  const zeros = (from: number, to: number) => hextets.slice(from, to).every((h) => h === 0);

  if (zeros(0, 5) && hextets[5] === 0xffff) {
    return ipv4FromHextets(hextets[6], hextets[7]);
  }

  if (zeros(0, 6) && (hextets[6] !== 0 || hextets[7] > 1)) {
    return ipv4FromHextets(hextets[6], hextets[7]);
  }

  if (hextets[0] === 0x64 && hextets[1] === 0xff9b && zeros(2, 6)) {
    return ipv4FromHextets(hextets[6], hextets[7]);
  }

  if (hextets[0] === 0x2002) {
    return ipv4FromHextets(hextets[1], hextets[2]);
  }

  if (hextets[0] === 0x2001 && hextets[1] === 0) {
    return ipv4FromHextets(hextets[6] ^ 0xffff, hextets[7] ^ 0xffff);
  }

  return null;
}

/**
 * True when `ip` is not a public unicast address: private, loopback, link-local, unspecified, CGNAT, multicast,
 * reserved or documentation space — including IPv4 embedded in IPv6 (mapped, compatible, NAT64, 6to4, Teredo).
 * URL brackets and IPv6 zone ids are accepted. Non-IP input returns false (callers resolve hostnames first).
 */
export function isPrivateOrLoopbackIp(ip: string): boolean {
  const value = normalizeIpLiteral(ip);

  if (net.isIPv4(value)) {
    return blockList.check(value, 'ipv4');
  }

  if (!net.isIPv6(value)) {
    return false;
  }

  if (blockList.check(value, 'ipv6')) {
    return true;
  }

  const hextets = expandIpv6(value);

  if (!hextets) {
    // Unparseable but valid per net.isIPv6: fail closed.
    return true;
  }

  const v4 = embeddedIpv4(hextets);

  return v4 !== null && blockList.check(v4, 'ipv4');
}

/**
 * True for `localhost`, `*.localhost`, `*.local`, or when `hostname` is a non-public IP literal (brackets allowed).
 */
export function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return true;
  }

  const literal = normalizeIpLiteral(host);

  if (net.isIP(literal)) {
    return isPrivateOrLoopbackIp(literal);
  }

  return false;
}

const DEV_SELF_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Local dev hostnames/IPs that skip strict DNS rebinding checks when resolving CONFIG URLs. */
export function isDevSelfHost(hostname: string): boolean {
  return DEV_SELF_HOSTS.has(normalizeIpLiteral(hostname.trim().toLowerCase()));
}
