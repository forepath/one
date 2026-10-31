/**
 * The MessagePack subset Terraform's `DynamicValue.msgpack` uses (cty's msgpack encoding): nil, booleans, integers,
 * float64, strings, binary, arrays, maps and extension values. cty encodes an unknown value as an extension (type 0,
 * or type 12 for an unknown with refinements); every extension decodes to {@link UNKNOWN}.
 *
 * Own implementation instead of a dependency: about 200 lines, no native addon (the provider is a single
 * executable), and the unknown-value extension needs special handling either way.
 */

/** An unknown value (`(known after apply)`). */
export const UNKNOWN: unique symbol = Symbol.for('loadweaver.terraform.unknown');
export type Unknown = typeof UNKNOWN;

export type MsgpackValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | Uint8Array
  | Unknown
  | MsgpackValue[]
  | { [key: string]: MsgpackValue };

export function isUnknown(value: unknown): value is Unknown {
  return value === UNKNOWN;
}

class Writer {
  private chunks: Buffer[] = [];

  byte(b: number): void {
    this.chunks.push(Buffer.from([b]));
  }

  bytes(b: Uint8Array): void {
    this.chunks.push(Buffer.from(b));
  }

  u8(prefix: number, v: number): void {
    const b = Buffer.alloc(2);

    b[0] = prefix;
    b.writeUInt8(v, 1);
    this.chunks.push(b);
  }

  u16(prefix: number, v: number): void {
    const b = Buffer.alloc(3);

    b[0] = prefix;
    b.writeUInt16BE(v, 1);
    this.chunks.push(b);
  }

  u32(prefix: number, v: number): void {
    const b = Buffer.alloc(5);

    b[0] = prefix;
    b.writeUInt32BE(v, 1);
    this.chunks.push(b);
  }

  result(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

function writeInteger(w: Writer, v: bigint): void {
  if (v >= 0n) {
    if (v < 128n) w.byte(Number(v));
    else if (v < 0x100n) w.u8(0xcc, Number(v));
    else if (v < 0x10000n) w.u16(0xcd, Number(v));
    else if (v < 0x100000000n) w.u32(0xce, Number(v));
    else if (v < 0x10000000000000000n) {
      const b = Buffer.alloc(9);

      b[0] = 0xcf;
      b.writeBigUInt64BE(v, 1);
      w.bytes(b);
    } else throw new RangeError(`integer ${v} does not fit into 64 bits`);

    return;
  }

  if (v >= -32n) w.byte(Number(v) & 0xff);
  else if (v >= -0x80n) {
    const b = Buffer.alloc(2);

    b[0] = 0xd0;
    b.writeInt8(Number(v), 1);
    w.bytes(b);
  } else if (v >= -0x8000n) {
    const b = Buffer.alloc(3);

    b[0] = 0xd1;
    b.writeInt16BE(Number(v), 1);
    w.bytes(b);
  } else if (v >= -0x80000000n) {
    const b = Buffer.alloc(5);

    b[0] = 0xd2;
    b.writeInt32BE(Number(v), 1);
    w.bytes(b);
  } else if (v >= -0x8000000000000000n) {
    const b = Buffer.alloc(9);

    b[0] = 0xd3;
    b.writeBigInt64BE(v, 1);
    w.bytes(b);
  } else throw new RangeError(`integer ${v} does not fit into 64 bits`);
}

function writeLength(
  w: Writer,
  len: number,
  fix: number | null,
  fixMax: number,
  p8: number | null,
  p16: number,
  p32: number,
) {
  if (fix !== null && len <= fixMax) w.byte(fix | len);
  else if (p8 !== null && len < 0x100) w.u8(p8, len);
  else if (len < 0x10000) w.u16(p16, len);
  else w.u32(p32, len);
}

function write(w: Writer, value: MsgpackValue): void {
  if (value === null || value === undefined) return w.byte(0xc0);

  if (value === UNKNOWN) {
    // fixext1, type 0, one zero byte: what cty writes for an unknown value.
    w.bytes(Uint8Array.from([0xd4, 0x00, 0x00]));

    return;
  }

  switch (typeof value) {
    case 'boolean':
      return w.byte(value ? 0xc3 : 0xc2);
    case 'bigint':
      return writeInteger(w, value);
    case 'number': {
      if (Number.isSafeInteger(value)) return writeInteger(w, BigInt(value));

      const b = Buffer.alloc(9);

      b[0] = 0xcb;
      b.writeDoubleBE(value, 1);

      return w.bytes(b);
    }
    case 'string': {
      const data = Buffer.from(value, 'utf8');

      writeLength(w, data.length, 0xa0, 31, 0xd9, 0xda, 0xdb);

      return w.bytes(data);
    }
  }

  if (value instanceof Uint8Array) {
    writeLength(w, value.length, null, 0, 0xc4, 0xc5, 0xc6);

    return w.bytes(value);
  }

  if (Array.isArray(value)) {
    writeLength(w, value.length, 0x90, 15, null, 0xdc, 0xdd);

    for (const item of value) write(w, item);

    return;
  }

  const entries = Object.entries(value);

  writeLength(w, entries.length, 0x80, 15, null, 0xde, 0xdf);

  for (const [key, item] of entries) {
    write(w, key);
    write(w, item);
  }
}

/** Encodes a value; `UNKNOWN` becomes cty's unknown-value extension. */
export function encodeMsgpack(value: MsgpackValue): Buffer {
  const w = new Writer();

  write(w, value);

  return w.result();
}

class Reader {
  offset = 0;

  constructor(private readonly buf: Buffer) {}

  need(n: number): void {
    if (this.offset + n > this.buf.length) throw new RangeError('truncated msgpack data');
  }

  take(n: number): Buffer {
    this.need(n);

    const out = this.buf.subarray(this.offset, this.offset + n);

    this.offset += n;

    return out;
  }

  u8(): number {
    this.need(1);

    return this.buf[this.offset++];
  }

  done(): boolean {
    return this.offset >= this.buf.length;
  }
}

/** Integers beyond the safe range stay `bigint` so no precision is lost (cty numbers are arbitrary precision). */
function int(v: bigint): number | bigint {
  return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(v) : v;
}

function read(r: Reader, depth: number): MsgpackValue {
  if (depth > 64) throw new RangeError('msgpack data nested too deeply');

  const b = r.u8();

  if (b <= 0x7f) return b;

  if (b >= 0xe0) return b - 0x100;

  if ((b & 0xe0) === 0xa0) return r.take(b & 0x1f).toString('utf8');

  if ((b & 0xf0) === 0x90) return readArray(r, b & 0x0f, depth);

  if ((b & 0xf0) === 0x80) return readMap(r, b & 0x0f, depth);

  switch (b) {
    case 0xc0:
      return null;
    case 0xc2:
      return false;
    case 0xc3:
      return true;
    case 0xc4:
      return Uint8Array.from(r.take(r.u8()));
    case 0xc5:
      return Uint8Array.from(r.take(r.take(2).readUInt16BE(0)));
    case 0xc6:
      return Uint8Array.from(r.take(r.take(4).readUInt32BE(0)));
    case 0xc7:
      return readExt(r, r.u8());
    case 0xc8:
      return readExt(r, r.take(2).readUInt16BE(0));
    case 0xc9:
      return readExt(r, r.take(4).readUInt32BE(0));
    case 0xca:
      return r.take(4).readFloatBE(0);
    case 0xcb:
      return r.take(8).readDoubleBE(0);
    case 0xcc:
      return r.u8();
    case 0xcd:
      return r.take(2).readUInt16BE(0);
    case 0xce:
      return r.take(4).readUInt32BE(0);
    case 0xcf:
      return int(r.take(8).readBigUInt64BE(0));
    case 0xd0:
      return r.take(1).readInt8(0);
    case 0xd1:
      return r.take(2).readInt16BE(0);
    case 0xd2:
      return r.take(4).readInt32BE(0);
    case 0xd3:
      return int(r.take(8).readBigInt64BE(0));
    case 0xd4:
      return readExt(r, 1);
    case 0xd5:
      return readExt(r, 2);
    case 0xd6:
      return readExt(r, 4);
    case 0xd7:
      return readExt(r, 8);
    case 0xd8:
      return readExt(r, 16);
    case 0xd9:
      return r.take(r.u8()).toString('utf8');
    case 0xda:
      return r.take(r.take(2).readUInt16BE(0)).toString('utf8');
    case 0xdb:
      return r.take(r.take(4).readUInt32BE(0)).toString('utf8');
    case 0xdc:
      return readArray(r, r.take(2).readUInt16BE(0), depth);
    case 0xdd:
      return readArray(r, r.take(4).readUInt32BE(0), depth);
    case 0xde:
      return readMap(r, r.take(2).readUInt16BE(0), depth);
    case 0xdf:
      return readMap(r, r.take(4).readUInt32BE(0), depth);
    default:
      throw new RangeError(`unsupported msgpack type byte 0x${b.toString(16)}`);
  }
}

/** Every extension cty writes marks an unknown value (type 0, or 12 with refinements); its payload is skipped. */
function readExt(r: Reader, length: number): Unknown {
  r.take(1 + length);

  return UNKNOWN;
}

function readArray(r: Reader, n: number, depth: number): MsgpackValue[] {
  const out: MsgpackValue[] = [];

  for (let i = 0; i < n; i++) out.push(read(r, depth + 1));

  return out;
}

function readMap(r: Reader, n: number, depth: number): { [key: string]: MsgpackValue } {
  const out: { [key: string]: MsgpackValue } = Object.create(null);

  for (let i = 0; i < n; i++) {
    const key = read(r, depth + 1);

    if (typeof key !== 'string') throw new RangeError('msgpack map keys must be strings');

    out[key] = read(r, depth + 1);
  }

  return out;
}

/** Decodes one value; trailing bytes are refused. */
export function decodeMsgpack(data: Uint8Array): MsgpackValue {
  const r = new Reader(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  const value = read(r, 0);

  if (!r.done()) throw new RangeError('trailing bytes after msgpack value');

  return value;
}
