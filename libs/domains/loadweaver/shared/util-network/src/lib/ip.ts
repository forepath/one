/**
 * Dual-stack IP primitives (3.23: IPv4 and IPv6 everywhere).
 * Addresses are held as unsigned BigInts so IPv4 and IPv6 share one implementation.
 */

/* BigInt constants instead of literals, so consumers compiled for older targets still build. */
const B_0 = BigInt(0);
const B_16 = BigInt(16);
const B_24 = BigInt(24);
const B_8 = BigInt(8);
const B_HEX_FF = BigInt(0xff);
const B_HEX_FFFF = BigInt(0xffff);
const B_HEX_FFFFFFFF = BigInt(0xffffffff);

export type IpFamily = 4 | 6;

export interface IpAddress {
  family: IpFamily;
  value: bigint;
}

export const IPV4_BITS = 32;
export const IPV6_BITS = 128;

export function familyBits(family: IpFamily): number {
  return family === 4 ? IPV4_BITS : IPV6_BITS;
}

function parseIpv4(input: string): bigint | null {
  const parts = input.split('.');

  if (parts.length !== 4) return null;

  let value = B_0;

  for (const part of parts) {
    // No leading zeros (avoids octal ambiguity), 0-255 only.
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null;

    const octet = Number(part);

    if (octet > 255) return null;

    value = (value << B_8) | BigInt(octet);
  }

  return value;
}

function parseIpv6(input: string): bigint | null {
  if (input.length === 0 || input.length > 45) return null;

  let text = input;
  let tailV4: bigint | null = null;

  // Embedded IPv4 in the last 32 bits (e.g. ::ffff:192.0.2.1).
  const lastColon = text.lastIndexOf(':');

  if (lastColon >= 0 && text.slice(lastColon + 1).includes('.')) {
    tailV4 = parseIpv4(text.slice(lastColon + 1));

    if (tailV4 === null) return null;

    text = `${text.slice(0, lastColon + 1)}0:0`;
  }

  const doubleColon = text.indexOf('::');

  if (doubleColon !== text.lastIndexOf('::')) return null;

  const parseGroups = (segment: string): string[] | null => {
    if (segment === '') return [];

    const groups = segment.split(':');

    return groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g)) ? groups : null;
  };

  let groups: string[];

  if (doubleColon >= 0) {
    const head = parseGroups(text.slice(0, doubleColon));
    const tail = parseGroups(text.slice(doubleColon + 2));

    if (!head || !tail || head.length + tail.length > 7) return null;

    groups = [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail];
  } else {
    const all = parseGroups(text);

    if (!all || all.length !== 8) return null;

    groups = all;
  }

  let value = B_0;

  for (const group of groups) value = (value << B_16) | BigInt(parseInt(group, 16));

  if (tailV4 !== null) value = (value & ~B_HEX_FFFFFFFF) | tailV4;

  return value;
}

export function parseIp(input: string): IpAddress | null {
  const trimmed = input.trim();

  if (trimmed.includes(':')) {
    const value = parseIpv6(trimmed);

    return value === null ? null : { family: 6, value };
  }

  const value = parseIpv4(trimmed);

  return value === null ? null : { family: 4, value };
}

export function mustParseIp(input: string): IpAddress {
  const ip = parseIp(input);

  if (!ip) throw new Error(`invalid IP address: ${input}`);

  return ip;
}

export function isIp(input: string): boolean {
  return parseIp(input) !== null;
}

/** Canonical text form; IPv6 follows RFC 5952 (lowercase, longest zero run compressed). */
export function formatIp(ip: IpAddress): string {
  if (ip.family === 4) {
    return [B_24, B_16, B_8, B_0].map((shift) => ((ip.value >> shift) & B_HEX_FF).toString()).join('.');
  }

  const groups: number[] = [];

  for (let i = 7; i >= 0; i--) groups.push(Number((ip.value >> BigInt(i * 16)) & B_HEX_FFFF));

  let bestStart = -1;
  let bestLen = 0;

  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }

    let j = i;

    while (j < 8 && groups[j] === 0) j++;

    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }

    i = j;
  }

  const hex = groups.map((g) => g.toString(16));

  if (bestLen < 2) return hex.join(':');

  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLen).join(':')}`;
}

export function compareIp(a: IpAddress, b: IpAddress): number {
  if (a.family !== b.family) return a.family - b.family;

  return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
}
