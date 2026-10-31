/** Minimal DNS wire format (RFC 1035) for the node-local resolver: one question in, A / AAAA answers out. */

export const DNS_TYPE_A = 1;
export const DNS_TYPE_AAAA = 28;
export const DNS_CLASS_IN = 1;
export const RCODE_NOERROR = 0;
export const RCODE_FORMERR = 1;
export const RCODE_SERVFAIL = 2;
export const RCODE_NXDOMAIN = 3;
export const RCODE_REFUSED = 5;

export interface DnsQuestion {
  name: string;
  type: number;
  class: number;
}

export interface DnsQuery {
  id: number;
  flags: number;
  question: DnsQuestion;
  /** Byte offset right after the question (start of answer / additional sections). */
  questionEnd: number;
}

const MAX_NAME_LENGTH = 253;

/** Parses the header and the single question. Returns null for anything we don't serve locally. */
export function parseQuery(buf: Buffer): DnsQuery | null {
  if (buf.length < 12 || buf.length > 4096) return null;

  const id = buf.readUInt16BE(0);
  const flags = buf.readUInt16BE(2);
  const qdcount = buf.readUInt16BE(4);
  const isResponse = (flags & 0x8000) !== 0;
  const opcode = (flags >> 11) & 0x0f;

  if (isResponse || opcode !== 0 || qdcount !== 1) return null;

  const labels: string[] = [];
  let offset = 12;

  for (;;) {
    if (offset >= buf.length) return null;

    const length = buf[offset];

    // Compression pointers are not valid in a query's first name.
    if ((length & 0xc0) !== 0) return null;

    offset += 1;

    if (length === 0) break;

    if (offset + length > buf.length) return null;

    labels.push(
      buf
        .subarray(offset, offset + length)
        .toString('latin1')
        .toLowerCase(),
    );
    offset += length;
  }

  const name = labels.join('.');

  if (name.length > MAX_NAME_LENGTH || offset + 4 > buf.length) return null;

  return {
    id,
    flags,
    question: { name, type: buf.readUInt16BE(offset), class: buf.readUInt16BE(offset + 2) },
    questionEnd: offset + 4,
  };
}

function encodeName(name: string): Buffer {
  const parts = name
    .split('.')
    .filter(Boolean)
    .map((label) => {
      const bytes = Buffer.from(label, 'latin1');

      return Buffer.concat([Buffer.from([bytes.length]), bytes]);
    });

  return Buffer.concat([...parts, Buffer.from([0])]);
}

function encodeAddress(address: string, type: number): Buffer {
  if (type === DNS_TYPE_A) return Buffer.from(address.split('.').map(Number));

  const [head, tail = ''] = address.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = address.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  const out = Buffer.alloc(16);

  groups.forEach((g, i) => out.writeUInt16BE(parseInt(g, 16), i * 2));

  return out;
}

/**
 * Builds a response for the query: recursion available, authoritative for the cluster domain,
 * answers pointing back at the question name (compression pointer 0xc00c).
 */
export function buildResponse(query: DnsQuery, rcode: number, addresses: string[] = [], ttl = 30): Buffer {
  const header = Buffer.alloc(12);
  const rd = query.flags & 0x0100;

  header.writeUInt16BE(query.id, 0);
  header.writeUInt16BE(0x8000 | 0x0400 | rd | 0x0080 | (rcode & 0x0f), 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(addresses.length, 6);

  const question = Buffer.concat([
    encodeName(query.question.name),
    Buffer.from([query.question.type >> 8, query.question.type & 0xff, 0, DNS_CLASS_IN]),
  ]);
  const answers = addresses.map((address) => {
    const rdata = encodeAddress(address, query.question.type);
    const rr = Buffer.alloc(12);

    rr.writeUInt16BE(0xc00c, 0);
    rr.writeUInt16BE(query.question.type, 2);
    rr.writeUInt16BE(DNS_CLASS_IN, 4);
    rr.writeUInt32BE(ttl, 6);
    rr.writeUInt16BE(rdata.length, 10);

    return Buffer.concat([rr, rdata]);
  });

  return Buffer.concat([header, question, ...answers]);
}
