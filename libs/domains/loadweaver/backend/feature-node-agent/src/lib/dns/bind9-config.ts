import { createHash } from 'node:crypto';

import type { AuthoritativeDns } from '@forepath/loadweaver/shared/util-agent-protocol';
import { COMPONENT_IMAGES } from '@forepath/loadweaver/shared/util-release';

import type { ManagedContainerSpec } from '../host/managed-containers';
import { componentImage } from '../updates/release-images';

/** This build's pin (section 6, `COMPONENT_IMAGES`); the node runs its release's image instead (3.26). */
export const DEFAULT_BIND9_IMAGE = COMPONENT_IMAGES['bind9'];
export const BIND9_CONTAINER = 'lw-bind9';
export const BIND9_COMPONENT = 'authoritative-dns';
/** Inside the container. */
export const BIND9_DIR = '/etc/bind/lw';

export function bind9Image(env: NodeJS.ProcessEnv = process.env): string {
  return componentImage('bind9', env);
}

export function zoneFileName(zone: string): string {
  return `${zone}.zone`;
}

/** Inside the container: bind's writable data (signed zones, key state, transferred zones), kept across restarts. */
export const BIND9_DATA_DIR = '/var/lib/bind';
export const BIND9_UID = 53;
export const TSIG_CONF = 'tsig.conf';

export interface NamedConfPaths {
  /** Unsigned primary zones. */
  zones: string;
  /** Sources of signed zones (bind writes `.signed` / `.jnl` next to them). */
  signed: string;
}

/** Signed zones in a steering view are signed separately (same keys, their own state). */
export function keyDirectory(zone: string, view?: string): string {
  return view ? `${BIND9_DATA_DIR}/keys/${view}/${zone}` : `${BIND9_DATA_DIR}/keys/${zone}`;
}

/** Where a view's variant of a zone lives, below the zones / signed directories. */
export function viewZoneFile(view: string, zone: string): string {
  return `views/${view}/${zoneFileName(zone)}`;
}

/** Inside the container: the GeoIP country database (bind looks for this file name; DB-IP Lite works as one). */
export const GEOIP_DIR = `${BIND9_DIR}/geoip`;
export const GEOIP_FILE = 'GeoLite2-Country.mmdb';
/** Views share every zone they don't override from this one, which matches no client itself. */
export const BASE_VIEW = 'lw-base';

type View = NonNullable<AuthoritativeDns['views']>[number];

/** All conditions of a view at once: each `!{ !x; any; }` refuses clients that don't match x. */
function viewMatch(view: View): string {
  const conditions = [
    ...(view.country ? [`geoip country ${view.country}`] : []),
    ...(view.continent ? [`geoip continent ${view.continent}`] : []),
  ];

  return [
    ...conditions.map((c) => `!{ !${c}; any; };`),
    ...(view.networks?.length ? view.networks.map((n) => `${n};`) : ['any;']),
  ].join(' ');
}

/**
 * `!{ !a; !b; any; }` refuses everything but the listed addresses; what is left needs one of the keys. (Pairing each
 * address with only its own key isn't expressible: bind's ACLs stop at the first match.)
 */
function addressesAndKeys(transfers: readonly { address: string; key: string }[]): string {
  const addresses = [...new Set(transfers.map((t) => t.address))];
  const keys = [...new Set(transfers.map((t) => t.key))];

  return `!{ ${addresses.map((a) => `!${a};`).join(' ')} any; }; ${keys.map((k) => `key "${k}";`).join(' ')}`;
}

/**
 * Authoritative-only bind9 (3.15): no recursion, no transfers between the cluster's instances (every instance gets
 * the zones pushed), transfers and NOTIFY only to / from configured external servers with TSIG, version and identity
 * hidden, response rate limiting against reflection abuse. DNSSEC zones are signed by bind with the control plane's
 * keys (a CSK policy that never generates or retires keys on its own). Zone names, addresses and keys come validated.
 */
export function renderNamedConf(config: AuthoritativeDns, paths: NamedConfPaths): string {
  const v4 = config.listen.filter((a) => !a.includes(':'));
  const v6 = config.listen.filter((a) => a.includes(':'));
  const signed = config.zones.some((z) => z.dnssec);
  const notifies = config.zones.some((z) => z.transfers);

  const zone = (z: AuthoritativeDns['zones'][number], view?: { name: string; file: string }): string => {
    const lines = [`zone "${z.name}" {`];

    if (z.primaries) {
      lines.push(
        '  type secondary;',
        `  file "${BIND9_DATA_DIR}/secondary/${z.name}.db";`,
        `  primaries { ${z.primaries.map((a) => `${a} key "${z.transferKey}";`).join(' ')} };`,
      );
    } else if (z.dnssec) {
      lines.push(
        '  type primary;',
        `  file "${paths.signed}/${view ? viewZoneFile(view.name, z.name) : zoneFileName(z.name)}";`,
        `  dnssec-policy "${z.dnssec.mode === 'signed' ? 'lw' : 'insecure'}";`,
        `  key-directory "${keyDirectory(z.name, view?.name)}";`,
        '  inline-signing yes;',
      );
    } else {
      lines.push(
        '  type primary;',
        `  file "${paths.zones}/${view ? viewZoneFile(view.name, z.name) : zoneFileName(z.name)}";`,
      );
    }

    // Transfers come from the shared zone; a view's variant is never transferred.
    if (z.transfers && !view) {
      lines.push(
        `  allow-transfer { ${addressesAndKeys(z.transfers)} };`,
        '  notify explicit;',
        `  also-notify { ${z.transfers.map((t) => `${t.address} key "${t.key}";`).join(' ')} };`,
      );
    }

    lines.push('};');

    return lines.join('\n');
  };
  const zones = [...config.zones].sort((a, b) => a.name.localeCompare(b.name));
  const indent = (text: string) =>
    text
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n');
  const shared = (z: AuthoritativeDns['zones'][number]) => `  zone "${z.name}" { in-view "${BASE_VIEW}"; };`;
  const body = config.views?.length
    ? [
        `view "${BASE_VIEW}" {`,
        '  match-clients { none; };',
        ...zones.map((z) => indent(zone(z))),
        '};',
        ...config.views.flatMap((v) => [
          `view "${v.name}" {`,
          `  match-clients { ${viewMatch(v)} };`,
          ...zones.map((z) => {
            const variant = v.zones.find((o) => o.name === z.name);

            return variant ? indent(zone(z, { name: v.name, file: variant.file })) : shared(z);
          }),
          '};',
        ]),
        'view "default" {',
        '  match-clients { any; };',
        ...zones.map(shared),
        '};',
      ]
    : zones.map((z) => zone(z));

  return [
    '// Managed by the Loadweaver node agent. Changes are overwritten.',
    ...(config.tsigKeys?.length ? [`include "${BIND9_DIR}/${TSIG_CONF}";`] : []),
    'options {',
    '  directory "/var/cache/bind";',
    `  listen-on { ${v4.length ? v4.map((a) => `${a};`).join(' ') : 'none;'} };`,
    `  listen-on-v6 { ${v6.length ? v6.map((a) => `${a};`).join(' ') : 'none;'} };`,
    '  recursion no;',
    // Without signed zones there is nothing to validate; with them, bind checks the DS at the parent before a key
    // rollover moves on, so those lookups are validated.
    `  dnssec-validation ${signed ? 'auto' : 'no'};`,
    '  allow-query { any; };',
    '  allow-transfer { none; };',
    // Every instance gets the zones pushed: no NOTIFY / transfer chain between them; external secondaries only.
    `  notify ${notifies ? 'explicit' : 'no'};`,
    '  version none;',
    '  hostname none;',
    '  server-id none;',
    '  minimal-responses yes;',
    '  rate-limit { responses-per-second 20; window 5; };',
    ...(config.geoip ? [`  geoip-directory "${GEOIP_DIR}";`] : []),
    '};',
    ...(signed
      ? ['dnssec-policy "lw" {', '  keys { csk key-directory lifetime unlimited algorithm ecdsap256sha256; };', '};']
      : []),
    ...body,
    '',
  ].join('\n');
}

/** TSIG keys, in their own file readable only by bind's group (named.conf stays world-readable). */
export function renderTsigConf(config: AuthoritativeDns): string {
  return (config.tsigKeys ?? [])
    .map((k) => `key "${k.name}" { algorithm ${k.algorithm}; secret "${k.secret ?? ''}"; };`)
    .join('\n')
    .concat('\n');
}

export function bind9Spec(dir: string, dataDir: string, namedConf: string, image: string): ManagedContainerSpec {
  return {
    name: BIND9_CONTAINER,
    image,
    // The image starts `named -u bind`; foreground with logs on stderr.
    cmd: ['-g', '-c', `${BIND9_DIR}/named.conf`],
    env: {},
    binds: [`${dir}:${BIND9_DIR}:ro`, `${dataDir}:${BIND9_DATA_DIR}`],
    memoryBytes: 256 * 1024 ** 2,
    hash: createHash('sha256').update(JSON.stringify({ image, namedConf })).digest('hex').slice(0, 16),
    component: BIND9_COMPONENT,
    hardening: {
      capDrop: ['ALL'],
      capAdd: ['NET_BIND_SERVICE', 'SETUID', 'SETGID'],
      readOnlyRootfs: true,
      noNewPrivileges: true,
      tmpfs: ['/var/cache/bind', '/run/named', '/tmp'],
    },
  };
}
