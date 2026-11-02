import { inflateRawSync } from 'node:zlib';

import { zipBuffer } from './zip.utils';

/** Reads entries back through the central directory, as unzip tools do. */
function unzip(zip: Buffer): Record<string, string> {
  const end = zip.length - 22;

  expect(zip.readUInt32LE(end)).toBe(0x06054b50);

  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const out: Record<string, string> = {};

  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);

    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const local = zip.readUInt32LE(at + 42);
    const localNameLength = zip.readUInt16LE(local + 26);
    const data = zip.subarray(local + 30 + localNameLength, local + 30 + localNameLength + size);

    out[name] = inflateRawSync(data).toString('utf8');
    at += 46 + nameLength;
  }

  return out;
}

describe('zip', () => {
  it('writes entries unzip tools read back', () => {
    const zip = zipBuffer([
      { name: '2026/09/report.html', content: Buffer.from('<h1>September</h1>') },
      { name: 'ümlaut.json', content: Buffer.from('{"a":1}'.repeat(1000)) },
    ]);

    expect(zip.subarray(0, 2).toString()).toBe('PK');
    expect(unzip(zip)).toEqual({ '2026/09/report.html': '<h1>September</h1>', 'ümlaut.json': '{"a":1}'.repeat(1000) });
    expect(unzip(zipBuffer([]))).toEqual({});
  });
});
