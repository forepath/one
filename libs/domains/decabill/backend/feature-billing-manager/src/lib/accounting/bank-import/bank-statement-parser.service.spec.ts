import * as zlib from 'zlib';
import { deflateRawSync } from 'zlib';

import { BankStatementParserService } from './bank-statement-parser.service';

const MT940 = [
  ':20:STARTUMS',
  ':25:10020030/1234567890',
  ':28C:00001/001',
  ':60F:C260310EUR1000,00',
  ':61:2603110311CR119,00NTRFNONREF//BANKREF1',
  ':86:166?00SEPA-GUTSCHRIFT?20EREF+INV-2026-00042?21SVWZ+Rechnung INV-2026-00042?32Fischer GmbH',
  ':62F:C260311EUR1119,00',
  '-',
].join('\r\n');

function zip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const compressed = deflateRawSync(file.data);
    const name = Buffer.from(file.name);
    const local = Buffer.alloc(30);

    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE((zlib as unknown as { crc32?: (b: Buffer) => number }).crc32?.(file.data) ?? 0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);

    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(local.readUInt32LE(14), 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);

  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, cd, end]);
}

describe('BankStatementParserService', () => {
  const service = new BankStatementParserService();

  it('detects and parses an MT940 upload (windows-1252 fallback)', () => {
    const result = service.parse({ buffer: Buffer.from(MT940, 'latin1'), fileName: 'umsatz.sta' });

    expect(result.files[0].parsed.format).toBe('mt940');
    expect(result.files[0].parsed.statements[0].transactions[0]).toEqual(
      expect.objectContaining({ amount: '119.00', bookingDate: '2026-03-11', bankReference: 'BANKREF1' }),
    );
  });

  it('parses every statement file of a ZIP and skips unknown entries with a warning', () => {
    const buffer = zip([
      { name: 'a.sta', data: Buffer.from(MT940) },
      { name: 'readme.bin', data: Buffer.from([1, 2, 3, 4]) },
    ]);
    const result = service.parse({ buffer, fileName: 'export.zip' });

    expect(result.files).toHaveLength(1);
    expect(result.warnings.join(' ')).toMatch(/readme\.bin/);
  });

  it('rejects CSV without a mapping and XML with a DOCTYPE', () => {
    expect(() => service.parse({ buffer: Buffer.from('a;b\n1;2\n3;4\n'), fileName: 'x.csv', format: 'csv' })).toThrow(
      /mapping/,
    );
    expect(() =>
      service.parse({
        buffer: Buffer.from(
          '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "boom">]><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">&e;</Document>',
        ),
        fileName: 'x.xml',
        format: 'camt.053',
      }),
    ).toThrow();
  });
});
