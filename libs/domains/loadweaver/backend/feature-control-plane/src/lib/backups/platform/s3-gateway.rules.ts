/**
 * Rules of the platform-backup S3 gateway (3.20, M6 decision): WAL-G and OpenSearch write the control plane's own
 * backups through it with per-client credentials, never with the Garage key. Clients may read and list their prefix
 * and create new objects; overwrites only for the few keys their formats rewrite; deletes only while the control
 * plane's retention holds a grant for the client (or by the control plane itself).
 */

/** The Garage bucket of all control-plane backups and the gateway's region (shared with the node agent's bootstrap). */
import { GATEWAY_REGION, PLATFORM_BUCKET } from '@forepath/loadweaver/shared/util-agent-protocol';

export { GATEWAY_REGION, PLATFORM_BUCKET };
export const GIB = 1024 ** 3;
/** S3's own limit for a single PUT / part. */
export const MAX_PART_BYTES = 5 * GIB;

export type GatewayRole = 'postgres' | 'opensearch' | 'control-plane';

export interface GatewayPrincipal {
  accessKeyId: string;
  role: GatewayRole;
  /** The member the credential was issued for (null: the control plane itself). */
  node: string | null;
  /** Keys the principal may read, list and create (and, with a grant, delete). */
  prefix: string;
  /** Keys under the prefix the client's format overwrites in place. */
  overwritable: (key: string) => boolean;
  maxObjectBytes: number;
}

/** Key prefixes of the platform backups in the bucket. */
export const PLATFORM_PREFIXES = {
  /** WAL-G (Spilo): `spilo/<scope>/wal/17/{basebackups_005,wal_005}/…`, clones read other scopes. */
  postgres: 'spilo/',
  /** OpenSearch snapshot repositories: `opensearch/<cluster>/…` (repository `base_path`). */
  opensearch: 'opensearch/',
  etcd: 'etcd/',
  drEnvelope: 'dr-envelope/',
} as const;

/**
 * OpenSearch's blob-store repository format rewrites exactly two root blobs: `index.latest` (pointer to the newest
 * `index-N`, rewritten by every snapshot) and `incompatible-snapshots`. `index-N`, `snap-*.dat`, `meta-*.dat` and the
 * shard blobs are written once (OpenSearch fails itself if they exist).
 */
export function openSearchOverwritable(key: string): boolean {
  return /^opensearch\/[^/]+\/(index\.latest|incompatible-snapshots)$/.test(key);
}

export function principalFor(
  role: GatewayRole,
  accessKeyId: string,
  node: string | null,
  maxObjectBytes = MAX_PART_BYTES,
): GatewayPrincipal {
  switch (role) {
    case 'postgres':
      // WAL-G only writes new objects: WAL segments (WALG_PREVENT_WAL_OVERWRITE skips identical re-pushes),
      // history files, base backup tars and sentinels.
      return {
        accessKeyId,
        role,
        node,
        prefix: PLATFORM_PREFIXES.postgres,
        overwritable: () => false,
        maxObjectBytes,
      };
    case 'opensearch':
      return {
        accessKeyId,
        role,
        node,
        prefix: PLATFORM_PREFIXES.opensearch,
        overwritable: openSearchOverwritable,
        maxObjectBytes,
      };
    case 'control-plane':
      return { accessKeyId, role, node, prefix: '', overwritable: () => false, maxObjectBytes };
  }
}

export type S3Operation =
  | { kind: 'bucket-meta' }
  | { kind: 'list-objects'; prefix: string }
  | { kind: 'list-multipart'; prefix: string }
  | { kind: 'get-object'; key: string }
  | { kind: 'put-object'; key: string }
  | { kind: 'create-multipart'; key: string }
  | { kind: 'upload-part'; key: string }
  | { kind: 'list-parts'; key: string }
  | { kind: 'complete-multipart'; key: string }
  | { kind: 'abort-multipart'; key: string }
  | { kind: 'delete-object'; key: string }
  | { kind: 'delete-objects' }
  | { kind: 'unsupported'; reason: string };

/** Sub-resources a client may name on a request; anything else (`?acl`, `?policy`, `?tagging`, ...) is refused. */
const LIST_QUERY = new Set([
  'list-type',
  'prefix',
  'delimiter',
  'max-keys',
  'continuation-token',
  'start-after',
  'fetch-owner',
  'encoding-type',
  'marker',
  'x-id',
]);
const OBJECT_QUERY = new Set([
  'partNumber',
  'uploadId',
  'versionId',
  'x-id',
  'response-content-type',
  'max-parts',
  'part-number-marker',
]);

/** Splits a decoded path-style path (`/bucket/key`) into bucket and key. */
export function splitPath(decodedPath: string): { bucket: string; key: string } {
  const trimmed = decodedPath.replace(/^\/+/, '');
  const slash = trimmed.indexOf('/');

  return slash < 0 ? { bucket: trimmed, key: '' } : { bucket: trimmed.slice(0, slash), key: trimmed.slice(slash + 1) };
}

export function classifyRequest(
  method: string,
  key: string,
  query: ReadonlyMap<string, string>,
  headers: { copySource?: boolean },
): S3Operation {
  const has = (name: string) => query.has(name);
  const onlyKnown = (allowed: Set<string>) => [...query.keys()].every((k) => allowed.has(k));

  if (key === '') {
    switch (method) {
      case 'HEAD':
        return query.size === 0 ? { kind: 'bucket-meta' } : { kind: 'unsupported', reason: 'bucket sub-resource' };
      case 'GET':
        if (has('location') && query.size === 1) return { kind: 'bucket-meta' };

        if (has('uploads')) return { kind: 'list-multipart', prefix: query.get('prefix') ?? '' };

        if (!onlyKnown(LIST_QUERY)) return { kind: 'unsupported', reason: 'bucket sub-resource' };

        return { kind: 'list-objects', prefix: query.get('prefix') ?? '' };
      case 'POST':
        return has('delete') && query.size === 1
          ? { kind: 'delete-objects' }
          : { kind: 'unsupported', reason: 'bucket POST' };
      default:
        return { kind: 'unsupported', reason: `bucket ${method}` };
    }
  }

  if (has('uploads')) {
    return method === 'POST' && query.size === 1
      ? { kind: 'create-multipart', key }
      : { kind: 'unsupported', reason: 'uploads' };
  }

  if (!onlyKnown(OBJECT_QUERY)) return { kind: 'unsupported', reason: 'object sub-resource' };

  if (has('versionId')) return { kind: 'unsupported', reason: 'object versions' };

  switch (method) {
    case 'GET':
      return has('uploadId') ? { kind: 'list-parts', key } : { kind: 'get-object', key };
    case 'HEAD':
      return { kind: 'get-object', key };
    case 'PUT':
      if (headers.copySource) return { kind: 'unsupported', reason: 'server-side copy' };

      if (has('uploadId') && has('partNumber')) return { kind: 'upload-part', key };

      return has('uploadId') || has('partNumber')
        ? { kind: 'unsupported', reason: 'malformed part upload' }
        : { kind: 'put-object', key };
    case 'POST':
      return has('uploadId') ? { kind: 'complete-multipart', key } : { kind: 'unsupported', reason: 'object POST' };
    case 'DELETE':
      return has('uploadId') ? { kind: 'abort-multipart', key } : { kind: 'delete-object', key };
    default:
      return { kind: 'unsupported', reason: `object ${method}` };
  }
}

export type Decision =
  | { allow: true; checkOverwrite: boolean; needsDeleteGrant: boolean }
  | { allow: false; status: number; code: string; message: string };

const deny = (status: number, code: string, message: string): Decision => ({ allow: false, status, code, message });

/** A safe object key: no traversal-like segments, no control characters, bounded length. */
export function safeKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= 1024 &&
    ![...key].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f) &&
    !key.split('/').some((s) => s === '..' || s === '.')
  );
}

/**
 * Decides one request. `bucket` must be the platform bucket; keys and list prefixes must lie under the principal's
 * prefix. Writes of existing keys are checked by the caller (HEAD before PUT under a per-key lock) unless the key is
 * overwritable; deletes need the retention grant (checked by the caller) unless the principal is the control plane.
 */
export function authorize(principal: GatewayPrincipal, bucket: string, op: S3Operation): Decision {
  if (bucket !== PLATFORM_BUCKET) return deny(403, 'AccessDenied', 'bucket not available through the gateway');

  const within = (key: string) => key.startsWith(principal.prefix);
  const keyed = 'key' in op ? op.key : null;

  if (keyed !== null && (!safeKey(keyed) || !within(keyed)))
    return deny(403, 'AccessDenied', 'key outside the client prefix');

  switch (op.kind) {
    case 'unsupported':
      return deny(403, 'AccessDenied', `operation not allowed through the gateway (${op.reason})`);
    case 'bucket-meta':
      return { allow: true, checkOverwrite: false, needsDeleteGrant: false };
    case 'list-objects':
    case 'list-multipart':
      return within(op.prefix)
        ? { allow: true, checkOverwrite: false, needsDeleteGrant: false }
        : deny(403, 'AccessDenied', 'list prefix outside the client prefix');
    case 'get-object':
    case 'list-parts':
    case 'upload-part':
    case 'abort-multipart':
      return { allow: true, checkOverwrite: false, needsDeleteGrant: false };
    case 'put-object':
    case 'create-multipart':
    case 'complete-multipart':
      return {
        allow: true,
        checkOverwrite: principal.role !== 'control-plane' && !principal.overwritable(op.key),
        needsDeleteGrant: false,
      };
    case 'delete-object':
    case 'delete-objects':
      return { allow: true, checkOverwrite: false, needsDeleteGrant: principal.role !== 'control-plane' };
  }
}

export const S3_XMLNS = 'http://s3.amazonaws.com/doc/2006-03-01/';

export class MalformedDeleteXml extends Error {}

export interface DeleteObjectsRequest {
  keys: string[];
  quiet: boolean;
}

/** Character data of a `Key`: no markup, only the predefined and numeric entities (no CDATA, comments, DTD refs). */
const XML_TEXT = /^[^<&]*(?:&(?:lt|gt|amp|quot|apos|#[0-9]{1,7}|#x[0-9a-fA-F]{1,6});[^<&]*)*$/;

/**
 * Strict parser of a `DeleteObjects` (`POST ?delete`) body (M6 review M1). Only the exact S3 grammar is accepted:
 * an optional XML declaration, `<Delete>` (optionally with the S3 default namespace), `<Object><Key>…</Key></Object>`
 * elements and at most one `<Quiet>true|false</Quiet>`, whitespace between elements. Anything else (attributes,
 * prefixed names, whitespace inside tags, comments, CDATA, processing instructions, DTDs, unknown entities,
 * `VersionId`) is refused, so the keys the gateway checks are exactly the keys it forwards — the caller rebuilds the
 * upstream body from them with {@link deleteObjectsXml}.
 */
export function parseDeleteObjects(xml: string): DeleteObjectsRequest {
  let pos = 0;
  const fail = (why: string): never => {
    throw new MalformedDeleteXml(`malformed DeleteObjects body: ${why}`);
  };
  const ws = () => {
    while (pos < xml.length && ' \t\r\n'.includes(xml[pos])) pos++;
  };
  const take = (literal: string): boolean => {
    if (!xml.startsWith(literal, pos)) return false;

    pos += literal.length;

    return true;
  };
  const text = (closing: string): string => {
    const end = xml.indexOf(closing, pos);

    if (end < 0) fail(`missing ${closing}`);

    const raw = xml.slice(pos, end);

    if (!XML_TEXT.test(raw)) fail('unexpected markup or entity in character data');

    pos = end + closing.length;

    try {
      return unescapeXml(raw);
    } catch {
      return fail('invalid character reference');
    }
  };

  if (xml.charCodeAt(0) === 0xfeff) pos = 1;

  if (xml.startsWith('<?xml', pos)) {
    const end = xml.indexOf('?>', pos);
    const decl = end < 0 ? '' : xml.slice(pos, end + 2);

    if (!/^<\?xml version="1\.[0-9]"(?: encoding="(?:UTF-8|utf-8)")?(?: standalone="(?:yes|no)")?\?>$/.test(decl))
      fail('unexpected XML declaration');

    pos = end + 2;
  }

  ws();

  if (!take('<Delete>') && !take(`<Delete xmlns="${S3_XMLNS}">`)) fail('expected <Delete>');

  const keys: string[] = [];
  let quiet: boolean | null = null;

  for (;;) {
    ws();

    if (take('</Delete>')) break;

    if (take('<Quiet>')) {
      if (quiet !== null) fail('duplicate <Quiet>');

      const value = text('</Quiet>');

      if (value !== 'true' && value !== 'false') fail('<Quiet> must be true or false');

      quiet = value === 'true';
      continue;
    }

    if (!take('<Object>')) fail('expected <Object>, <Quiet> or </Delete>');

    ws();

    if (!take('<Key>')) fail('expected <Key>');

    const key = text('</Key>');

    ws();

    if (xml.startsWith('<VersionId>', pos)) fail('object versions are not supported');

    if (!take('</Object>')) fail('expected </Object>');

    if (!safeKey(key)) fail('unsafe key');

    keys.push(key);
  }

  ws();

  if (pos !== xml.length) fail('trailing content after </Delete>');

  if (keys.length === 0) fail('no keys to delete');

  if (keys.length > 1000) fail('more than 1000 keys');

  return { keys, quiet: quiet ?? false };
}

/** The canonical `DeleteObjects` body the gateway forwards upstream (rebuilt from the checked keys). */
export function deleteObjectsXml(request: DeleteObjectsRequest): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Delete xmlns="${S3_XMLNS}">${
    request.quiet ? '<Quiet>true</Quiet>' : ''
  }${request.keys.map((k) => `<Object><Key>${escapeXml(k)}</Key></Object>`).join('')}</Delete>`;
}

/** Keys named in a `DeleteObjects` (`POST ?delete`) body; throws {@link MalformedDeleteXml} unless strictly valid. */
export function deleteObjectsKeys(xml: string): string[] {
  return parseDeleteObjects(xml).keys;
}

export function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function s3ErrorXml(code: string, message: string, resource = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${escapeXml(code)}</Code><Message>${escapeXml(
    message,
  )}</Message><Resource>${escapeXml(resource)}</Resource></Error>`;
}
