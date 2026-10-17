/**
 * Protobuf wire encoding of `loadweaver.agent.v1.Envelope` (see proto/agent.proto).
 * Hand-written because the message is tiny and fixed; it keeps the agent binary free of runtime .proto loading.
 */

export interface Envelope {
  type: string;
  id: string;
  correlationId?: string;
  channel?: string;
  payload: Uint8Array;
}

/** Upper bound for one message; file transfers are chunked well below this (3.19). */
export const MAX_ENVELOPE_BYTES = 16 * 1024 * 1024;

const WIRE_VARINT = 0;
const WIRE_LENGTH_DELIMITED = 2;

function encodeVarint(value: number, out: number[]): void {
  let v = value >>> 0;

  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }

  out.push(v);
}

function writeField(field: number, data: Uint8Array, chunks: Uint8Array[]): void {
  if (data.length === 0) return;

  const header: number[] = [];

  encodeVarint((field << 3) | WIRE_LENGTH_DELIMITED, header);
  encodeVarint(data.length, header);
  chunks.push(Uint8Array.from(header), data);
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export function encodeEnvelope(envelope: Envelope): Uint8Array {
  const chunks: Uint8Array[] = [];

  writeField(1, textEncoder.encode(envelope.type), chunks);
  writeField(2, textEncoder.encode(envelope.id), chunks);
  writeField(3, textEncoder.encode(envelope.correlationId ?? ''), chunks);
  writeField(4, textEncoder.encode(envelope.channel ?? ''), chunks);
  writeField(5, envelope.payload, chunks);

  const total = chunks.reduce((sum, c) => sum + c.length, 0);

  if (total > MAX_ENVELOPE_BYTES) throw new RangeError('envelope exceeds maximum size');

  const out = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }

  return out;
}

function readVarint(buf: Uint8Array, pos: { offset: number }): number {
  let result = 0;
  let shift = 0;

  for (;;) {
    if (pos.offset >= buf.length) throw new RangeError('truncated varint');

    if (shift > 28) throw new RangeError('varint too long');

    const byte = buf[pos.offset++];

    result |= (byte & 0x7f) << shift;

    if ((byte & 0x80) === 0) return result >>> 0;

    shift += 7;
  }
}

/** Decodes and validates an envelope. Unknown fields are skipped, as protobuf requires. */
export function decodeEnvelope(buf: Uint8Array): Envelope {
  if (buf.length > MAX_ENVELOPE_BYTES) throw new RangeError('envelope exceeds maximum size');

  const pos = { offset: 0 };
  const strings: Record<number, string> = {};
  let payload = new Uint8Array(0);

  while (pos.offset < buf.length) {
    const tag = readVarint(buf, pos);
    const field = tag >>> 3;
    const wire = tag & 0x7;

    if (wire === WIRE_VARINT) {
      readVarint(buf, pos);
      continue;
    }

    if (wire !== WIRE_LENGTH_DELIMITED) throw new RangeError(`unsupported wire type ${wire}`);

    const length = readVarint(buf, pos);

    if (pos.offset + length > buf.length) throw new RangeError('truncated field');

    const data = buf.subarray(pos.offset, pos.offset + length);

    pos.offset += length;

    if (field === 5) payload = Uint8Array.from(data);
    else if (field >= 1 && field <= 4) strings[field] = textDecoder.decode(data);
  }

  if (!strings[1]) throw new Error('envelope without type');

  if (!strings[2]) throw new Error('envelope without id');

  return {
    type: strings[1],
    id: strings[2],
    correlationId: strings[3] || undefined,
    channel: strings[4] || undefined,
    payload,
  };
}
