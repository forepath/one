import * as zlib from 'zlib';

import { BankStatementParseError } from '../bank-import.types';

import { isZip, readZipEntries } from './safe-zip';

interface FixtureEntry {
  name: string;
  data: Buffer;
  /** Compression actually applied (default deflate). */
  method?: 0 | 8;
  /** Method number written into the headers (defaults to `method`). */
  methodField?: number;
  flags?: number;
  /** Uncompressed size written into the headers (defaults to the real size). */
  declaredSize?: number;
  crc?: number;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;

  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }

  return c >>> 0;
});

function crc32(data: Buffer): number {
  if (typeof zlib.crc32 === 'function') {
    return zlib.crc32(data) >>> 0;
  }

  let crc = 0xffffffff;

  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/** Tiny ZIP writer for fixtures (no data descriptors, no ZIP64). */
function buildZip(entries: FixtureEntry[], eocdOverrides: { totalEntries?: number } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const method = entry.method ?? 8;
    const compressed = method === 8 ? zlib.deflateRawSync(entry.data) : entry.data;
    const name = Buffer.from(entry.name, 'utf8');
    const flags = (entry.flags ?? 0) | 0x0800;
    const crc = entry.crc ?? crc32(entry.data);
    const size = entry.declaredSize ?? entry.data.length;
    const methodField = entry.methodField ?? method;
    const local = Buffer.alloc(30);

    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(methodField, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);

    const central = Buffer.alloc(46);

    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(methodField, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, compressed);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  const count = eocdOverrides.totalEntries ?? entries.length;

  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralDir, eocd]);
}

const camtXml = Buffer.from(
  '<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"></Document>',
);

describe('safe-zip', () => {
  it('detects ZIP signatures', () => {
    expect(isZip(buildZip([{ name: 'a.xml', data: camtXml }]))).toBe(true);
    expect(isZip(buildZip([]))).toBe(true);
    expect(isZip(Buffer.from('<?xml version="1.0"?>'))).toBe(false);
    expect(isZip(Buffer.from('PK'))).toBe(false);
  });

  it('reads stored and deflated entries and skips directories, __MACOSX and dotfiles', () => {
    const zip = buildZip([
      { name: 'statements/', data: Buffer.alloc(0), method: 0 },
      { name: 'statements/2026-11-19_camt053.xml', data: camtXml },
      { name: 'statements/readme.txt', data: Buffer.from('hello'), method: 0 },
      { name: '__MACOSX/statements/._2026-11-19_camt053.xml', data: Buffer.from('junk') },
      { name: 'statements/.DS_Store', data: Buffer.from('junk') },
      { name: 'empty.xml', data: Buffer.alloc(0) },
    ]);
    const entries = readZipEntries(zip);

    expect(entries.map((e) => e.name)).toEqual([
      'statements/2026-11-19_camt053.xml',
      'statements/readme.txt',
      'empty.xml',
    ]);
    expect(entries[0].data.equals(camtXml)).toBe(true);
    expect(entries[1].data.toString()).toBe('hello');
    expect(entries[2].data.length).toBe(0);
  });

  it('treats zip-slip names purely as labels', () => {
    const entries = readZipEntries(
      buildZip([
        { name: '../../../../etc/cron.d/evil.xml', data: camtXml },
        { name: '/absolute/path.xml', data: camtXml },
        { name: 'dir\\..\\..\\windows.xml', data: camtXml },
      ]),
    );

    expect(entries.map((e) => e.name)).toEqual([
      '../../../../etc/cron.d/evil.xml',
      '/absolute/path.xml',
      'dir\\..\\..\\windows.xml',
    ]);
    expect(entries.every((e) => e.data.equals(camtXml))).toBe(true);
  });

  it('returns nested archives as raw entries without extracting them', () => {
    const inner = buildZip([{ name: 'inner.xml', data: camtXml }]);
    const entries = readZipEntries(buildZip([{ name: 'nested.zip', data: inner, method: 0 }]));

    expect(entries).toHaveLength(1);
    expect(isZip(entries[0].data)).toBe(true);
  });

  it('rejects zip bombs by compression ratio', () => {
    const bomb = buildZip([{ name: 'bomb.xml', data: Buffer.alloc(10 * 1024 * 1024, 0x20) }]);

    expect(() => readZipEntries(bomb)).toThrow(/compression ratio/);
  });

  it('rejects entries whose real size exceeds the declared size', () => {
    const lying = buildZip([{ name: 'liar.xml', data: Buffer.alloc(200_000, 0x41), declaredSize: 1000 }]);

    expect(() => readZipEntries(lying)).toThrow(BankStatementParseError);
  });

  it('enforces entry size, total size and entry count limits', () => {
    const data = Buffer.from('x'.repeat(200));

    expect(() => readZipEntries(buildZip([{ name: 'a.xml', data }]), { maxEntryBytes: 100 })).toThrow(
      /maximum uncompressed size/,
    );
    expect(() =>
      readZipEntries(
        buildZip([
          { name: 'a.xml', data },
          { name: 'b.xml', data },
        ]),
        { maxTotalUncompressedBytes: 300 },
      ),
    ).toThrow(/total uncompressed size/);
    expect(() =>
      readZipEntries(
        buildZip([
          { name: 'a.xml', data },
          { name: 'b.xml', data },
          { name: 'c.xml', data },
        ]),
        { maxEntries: 2 },
      ),
    ).toThrow(/too many entries/);
  });

  it('rejects encrypted entries', () => {
    const zip = buildZip([{ name: 'secret.xml', data: camtXml, flags: 0x0001 }]);

    expect(() => readZipEntries(zip)).toThrow(/Encrypted/);
  });

  it('rejects unsupported compression methods', () => {
    const zip = buildZip([{ name: 'a.xml', data: camtXml, method: 0, methodField: 12 }]);

    expect(() => readZipEntries(zip)).toThrow(/compression method 12/);
  });

  it('rejects ZIP64 archives', () => {
    const zip = buildZip([{ name: 'a.xml', data: camtXml }], { totalEntries: 0xffff });

    expect(() => readZipEntries(zip)).toThrow(/ZIP64/);
  });

  it('rejects CRC mismatches', () => {
    const zip = buildZip([{ name: 'a.xml', data: camtXml, method: 0, crc: 0x12345678 }]);

    expect(() => readZipEntries(zip)).toThrow(/CRC/);
  });

  it('rejects non-ZIP and truncated input', () => {
    expect(() => readZipEntries(Buffer.from('not a zip archive at all, definitely not'))).toThrow(
      BankStatementParseError,
    );

    const zip = buildZip([{ name: 'a.xml', data: camtXml }]);

    expect(() => readZipEntries(zip.subarray(0, 40))).toThrow(BankStatementParseError);
  });
});
