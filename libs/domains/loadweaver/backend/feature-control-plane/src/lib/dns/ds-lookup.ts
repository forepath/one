import { randomInt } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';

import type { DsRecord } from '@forepath/loadweaver/shared/util-pki';

const TYPE_DS = 43;
const CLASS_IN = 1;
const RCODE_NXDOMAIN = 3;

/** DS records the parent publishes for a zone; null when no parent server answered. */
export type DsLookup = (zone: string) => Promise<DsRecord[] | null>;

export function encodeDsQuery(zone: string, id: number): Buffer {
  const labels = zone
    .replace(/\.$/, '')
    .split('.')
    .map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l, 'ascii')]));
  const header = Buffer.alloc(12);

  header.writeUInt16BE(id, 0);
  // Standard query, no recursion: asked of the parent's authoritative servers.
  header.writeUInt16BE(0, 2);
  header.writeUInt16BE(1, 4);

  const question = Buffer.alloc(4);

  question.writeUInt16BE(TYPE_DS, 0);
  question.writeUInt16BE(CLASS_IN, 2);

  return Buffer.concat([header, ...labels, Buffer.from([0]), question]);
}

/** A (possibly compressed) name at `offset`, lower-cased without trailing dot, and the offset after it. */
function readName(buf: Buffer, start: number): { name: string; end: number } {
  const labels: string[] = [];
  let offset = start;
  let end: number | null = null;

  for (let jumps = 0; jumps < 64; ) {
    if (offset >= buf.length) throw new Error('truncated name');

    const len = buf[offset];

    if (len === 0) return { name: labels.join('.').toLowerCase(), end: end ?? offset + 1 };

    if ((len & 0xc0) === 0xc0) {
      if (offset + 1 >= buf.length) throw new Error('truncated name');

      end ??= offset + 2;
      offset = ((len & 0x3f) << 8) | buf[offset + 1];
      jumps++;
      continue;
    }

    if (offset + 1 + len > buf.length) throw new Error('truncated name');

    labels.push(buf.subarray(offset + 1, offset + 1 + len).toString('ascii'));
    offset += len + 1;
  }

  throw new Error('compression loop');
}

/**
 * The DS records of an authoritative answer for exactly this zone; [] for "no DS" (authoritative NXDOMAIN / NODATA).
 * Throws on anything else — referrals, answers for other names, truncation — so a spoofed or misdirected reply never
 * reads as "the DS is gone".
 */
export function decodeDsResponse(buf: Buffer, id: number, zone: string): DsRecord[] {
  if (buf.length < 12 || buf.readUInt16BE(0) !== id) throw new Error('unexpected response');

  const flags = buf.readUInt16BE(2);
  const rcode = flags & 0x0f;
  const owner = zone.replace(/\.$/, '').toLowerCase();

  if ((flags & 0x8000) === 0 || flags & 0x0200) throw new Error('not a complete response');

  if ((flags & 0x0400) === 0) throw new Error('not authoritative');

  const qdcount = buf.readUInt16BE(4);
  const ancount = buf.readUInt16BE(6);

  if (qdcount !== 1) throw new Error('unexpected question');

  const question = readName(buf, 12);

  if (
    question.name !== owner ||
    question.end + 4 > buf.length ||
    buf.readUInt16BE(question.end) !== TYPE_DS ||
    buf.readUInt16BE(question.end + 2) !== CLASS_IN
  )
    throw new Error('answer to another question');

  if (rcode === RCODE_NXDOMAIN) return [];

  if (rcode !== 0) throw new Error(`rcode ${rcode}`);

  let offset = question.end + 4;
  const records: DsRecord[] = [];

  for (let i = 0; i < ancount; i++) {
    const name = readName(buf, offset);

    offset = name.end;

    if (offset + 10 > buf.length) throw new Error('truncated record');

    const type = buf.readUInt16BE(offset);
    const length = buf.readUInt16BE(offset + 8);
    const rdata = buf.subarray(offset + 10, offset + 10 + length);

    if (rdata.length !== length) throw new Error('truncated record');

    if (type === TYPE_DS && name.name === owner && length > 4) {
      records.push({
        keyTag: rdata.readUInt16BE(0),
        algorithm: rdata[2],
        digestType: rdata[3],
        digest: rdata.subarray(4).toString('hex').toUpperCase(),
      });
    }

    offset += 10 + length;
  }

  return records;
}

export function queryDs(server: string, zone: string, timeoutMs = 3_000, port = 53): Promise<DsRecord[]> {
  const id = randomInt(0, 0x10000);
  const socket = createSocket(isIP(server) === 6 ? 'udp6' : 'udp4');

  return new Promise<DsRecord[]>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);

    socket.on('error', reject);
    socket.on('message', (msg, rinfo) => {
      if (rinfo.address !== server) return;

      try {
        resolve(decodeDsResponse(msg, id, zone));
      } catch (error) {
        reject(error);
      } finally {
        clearTimeout(timer);
      }
    });
    socket.send(encodeDsQuery(zone, id), port, server);
  }).finally(() => socket.close());
}

/** The closest enclosing zone with NS records and its servers' addresses. */
async function parentServers(zone: string, resolver: Resolver): Promise<string[]> {
  const labels = zone.replace(/\.$/, '').split('.');

  for (let i = 1; i < labels.length; i++) {
    const parent = labels.slice(i).join('.');
    const ns = await resolver.resolveNs(parent).catch(() => [] as string[]);

    if (ns.length === 0) continue;

    const addresses = await Promise.all(
      ns
        .slice(0, 4)
        .map(async (host) => [
          ...(await resolver.resolve4(host).catch(() => [] as string[])),
          ...(await resolver.resolve6(host).catch(() => [] as string[])),
        ]),
    );

    return addresses.flat();
  }

  return [];
}

const dsKey = (records: readonly DsRecord[]) =>
  records
    .map((d) => `${d.keyTag}/${d.algorithm}/${d.digestType}/${d.digest}`)
    .sort()
    .join();

/**
 * Asks the parent's authoritative servers directly. Two of them must give the same answer (one when the parent has
 * only one), so a single spoofed or stale reply changes nothing; null when they don't agree or don't answer.
 */
export const lookupDsAtParent: DsLookup = async (zone) => {
  const resolver = new Resolver({ timeout: 3_000, tries: 2 });
  const servers = (await parentServers(zone, resolver)).slice(0, 6);
  const needed = Math.min(2, servers.length);
  const answers: DsRecord[][] = [];

  for (const server of servers) {
    try {
      answers.push(await queryDs(server, zone));
    } catch {
      continue;
    }

    if (answers.length >= needed) break;
  }

  if (answers.length < needed || answers.length === 0) return null;

  return answers.every((a) => dsKey(a) === dsKey(answers[0])) ? answers[0] : null;
};
