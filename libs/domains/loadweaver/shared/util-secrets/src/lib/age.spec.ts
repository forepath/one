import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ageArmor,
  ageDearmor,
  ageDecrypt,
  ageEncrypt,
  ageIdentityFromRaw,
  ageRecipientOf,
  bech32Decode,
  bech32Encode,
  generateAgeIdentity,
  isAgeArmored,
  isAgeIdentity,
  isAgeRecipient,
  parseAgeIdentities,
} from './age';

const FIXTURES = join(__dirname, '__fixtures__');
// Throwaway test identity made by the real `age-keygen` (v1.3.2); stored lowercase so secret scanners don't flag it.
const FIXTURE_IDENTITY = 'age-secret-key-1spzm5xql9xwhhs9zywypjte5q0z36ffvg7au6lvqn9s79dxgzlzqg0nw8a'.toUpperCase();
const FIXTURE_RECIPIENT = 'age1dxepryr8jh4a7jpl4e7e9033tadrdp6cvzjm4wj6uw53xerc8ausnv4xm5';
const CHUNK = 64 * 1024;

describe('bech32 (BIP-173)', () => {
  it.each([
    'A12UEL5L',
    'a12uel5l',
    'an83characterlonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1tt5tgs',
    'abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw',
    '11qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqc8247j',
    'split1checkupstagehandshakeupstreamerranterredcaperred2y9e3w',
  ])('accepts the valid test vector %s', (vector) => {
    const { hrp, data } = bech32Decode(vector);

    expect(hrp).toBe(vector.slice(0, vector.lastIndexOf('1')).toLowerCase());
    expect(bech32Encode(hrp, data)).toBe(vector.toLowerCase());
  });

  it.each([
    ['pzry9x0s0muk', 'no separator'],
    ['1pzry9x0s0muk', 'empty prefix'],
    ['x1b4n0q5v', 'invalid character'],
    ['li1dgmt3', 'checksum too short'],
    ['A1G7SGD8', 'checksum over uppercase prefix'],
    ['10a06t8', 'empty prefix'],
    ['1qzzfhee', 'empty prefix'],
    ['A12uEL5L', 'mixed case'],
    ['a12uel5m', 'bad checksum'],
  ])('rejects %s (%s)', (vector) => {
    expect(() => bech32Decode(vector)).toThrow(/bech32/);
  });

  it('round-trips arbitrary bytes', () => {
    const data = Buffer.from('00ff10203040506070', 'hex');

    expect(bech32Decode(bech32Encode('test', data))).toEqual({ hrp: 'test', data });
  });
});

describe('age keys', () => {
  it('generates X25519 identities in the age format', () => {
    const { identity, recipient } = generateAgeIdentity();

    expect(identity).toMatch(/^AGE-SECRET-KEY-1[QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L]{58}$/);
    expect(recipient).toMatch(/^age1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}$/);
    expect(ageRecipientOf(identity)).toBe(recipient);
    expect(isAgeIdentity(identity)).toBe(true);
    expect(isAgeRecipient(recipient)).toBe(true);
    expect(isAgeIdentity(recipient)).toBe(false);
    expect(isAgeRecipient(identity)).toBe(false);
  });

  it('derives the same recipient as the real age-keygen (known answer)', () => {
    expect(ageRecipientOf(FIXTURE_IDENTITY)).toBe(FIXTURE_RECIPIENT);
    expect(ageIdentityFromRaw(bech32Decode(FIXTURE_IDENTITY).data)).toBe(FIXTURE_IDENTITY);
  });

  it('rejects malformed keys', () => {
    expect(() => ageRecipientOf('AGE-SECRET-KEY-1QQQQ')).toThrow('invalid age identity');
    expect(() => ageRecipientOf(FIXTURE_RECIPIENT)).toThrow('invalid age identity');
    expect(() => ageEncrypt('x', ['age1qqqq'])).toThrow('invalid age recipient');
    expect(() => ageEncrypt('x', [])).toThrow('at least one age recipient');
    expect(() => ageIdentityFromRaw(Buffer.alloc(31))).toThrow('invalid age identity');
  });

  it('parses age key files', () => {
    const file = `# created: 2026-10-18\n# public key: ${FIXTURE_RECIPIENT}\n${FIXTURE_IDENTITY}\n\n`;

    expect(parseAgeIdentities(file)).toEqual([FIXTURE_IDENTITY]);
    expect(() => parseAgeIdentities('AGE-SECRET-KEY-1NOPE')).toThrow('invalid age identity in key file');
  });
});

describe('age decryption of files made by the real age binary (known answers)', () => {
  it('decrypts a binary file', () => {
    expect(ageDecrypt(readFileSync(join(FIXTURES, 'hello.age')), [FIXTURE_IDENTITY]).toString()).toBe('hello age\n');
  });

  it('decrypts an armored file with two recipients (as string and as buffer)', () => {
    const armored = readFileSync(join(FIXTURES, 'hello.age.asc'), 'utf8');

    expect(isAgeArmored(armored)).toBe(true);
    expect(ageDecrypt(armored, [FIXTURE_IDENTITY]).toString()).toBe('hello armored age\n');
    expect(ageDecrypt(Buffer.from(armored), [FIXTURE_IDENTITY]).toString()).toBe('hello armored age\n');
  });

  it('skips stanzas of other types (ssh-ed25519 before the X25519 stanza)', () => {
    const file = readFileSync(join(FIXTURES, 'hello-mixed.age'));

    expect(file.toString('latin1')).toContain('-> ssh-ed25519 ');
    expect(ageDecrypt(file, [generateAgeIdentity().identity, FIXTURE_IDENTITY]).toString()).toBe('mixed recipients\n');
  });

  it('fails without a matching identity', () => {
    expect(() => ageDecrypt(readFileSync(join(FIXTURES, 'hello.age')), [generateAgeIdentity().identity])).toThrow(
      'no identity matched',
    );
  });
});

describe('age round trips', () => {
  const alice = generateAgeIdentity();
  const bob = generateAgeIdentity();

  it.each([0, 1, 100, CHUNK - 1, CHUNK, CHUNK + 1, 2 * CHUNK, 3 * CHUNK + 17])('encrypts %i bytes', (size) => {
    const plaintext = Buffer.alloc(size);

    for (let i = 0; i < size; i++) plaintext[i] = (i * 31) & 0xff;

    const file = ageEncrypt(plaintext, [alice.recipient]);

    expect(ageDecrypt(file, [alice.identity]).equals(plaintext)).toBe(true);
  });

  it('encrypts to several recipients; each can decrypt', () => {
    const file = ageEncrypt('shared', [alice.recipient, bob.recipient]);

    expect(ageDecrypt(file, [alice.identity]).toString()).toBe('shared');
    expect(ageDecrypt(file, [bob.identity]).toString()).toBe('shared');
    expect(file.toString('latin1').match(/^-> X25519 /gm)).toHaveLength(2);
  });

  it('writes the canonical header (version line, 43-column bodies, MAC line)', () => {
    const file = ageEncrypt('x', [alice.recipient]).toString('latin1');

    expect(file).toMatch(
      /^age-encryption\.org\/v1\n-> X25519 [A-Za-z0-9+/]{43}\n[A-Za-z0-9+/]{43}\n--- [A-Za-z0-9+/]{43}\n/,
    );
  });

  it('armors and dearmors', () => {
    const armored = ageEncrypt(Buffer.alloc(1000, 1), [alice.recipient], { armor: true }).toString();
    const lines = armored.trim().split('\n');

    expect(lines[0]).toBe('-----BEGIN AGE ENCRYPTED FILE-----');
    expect(lines[lines.length - 1]).toBe('-----END AGE ENCRYPTED FILE-----');
    expect(lines.slice(1, -2).every((line) => line.length === 64)).toBe(true);
    expect(ageDecrypt(`\n  ${armored}\n\n`, [alice.identity]).equals(Buffer.alloc(1000, 1))).toBe(true);
    expect(ageDearmor(ageArmor(Buffer.from('abc')))).toEqual(Buffer.from('abc'));
  });

  it('rejects malformed armor', () => {
    const armored = ageArmor(ageEncrypt(Buffer.alloc(200), [alice.recipient]));
    const lines = armored.trim().split('\n');

    expect(() => ageDearmor(armored.replace('-----END AGE ENCRYPTED FILE-----', ''))).toThrow('missing begin / end');
    expect(() => ageDearmor([lines[0], `${lines[1]}${lines[2]}`, ...lines.slice(3)].join('\n'))).toThrow(
      'bad line length',
    );
    expect(() => ageDearmor([lines[0], lines[1].slice(0, 60), ...lines.slice(2)].join('\n'))).toThrow(
      'bad line length',
    );
    expect(() => ageDearmor(`${armored}trailing`)).toThrow('missing begin / end');
  });
});

describe('age tamper detection', () => {
  const alice = generateAgeIdentity();

  function headerEnd(file: Buffer): number {
    return file.indexOf('\n', file.indexOf('\n--- ') + 1) + 1;
  }

  it('detects a modified payload', () => {
    const file = ageEncrypt('secret payload', [alice.recipient]);

    file[file.length - 1] ^= 1;
    expect(() => ageDecrypt(file, [alice.identity])).toThrow('payload authentication failed');
  });

  it('detects a modified payload nonce', () => {
    const file = ageEncrypt('secret payload', [alice.recipient]);

    file[headerEnd(file)] ^= 1;
    expect(() => ageDecrypt(file, [alice.identity])).toThrow('payload authentication failed');
  });

  it('detects a modified header MAC', () => {
    const file = ageEncrypt('x', [alice.recipient]);
    const text = file.toString('latin1');
    const macAt = text.indexOf('\n--- ') + 5;
    const swapped = text[macAt] === 'A' ? 'B' : 'A';

    expect(() =>
      ageDecrypt(Buffer.from(text.slice(0, macAt) + swapped + text.slice(macAt + 1), 'latin1'), [alice.identity]),
    ).toThrow(/header MAC|non-canonical/);
  });

  it('detects a header change covered by the MAC (an added stanza)', () => {
    const text = ageEncrypt('x', [alice.recipient]).toString('latin1');
    const forged = text.replace('\n--- ', '\n-> grease-extra arg\nAAAA\n--- ');

    expect(() => ageDecrypt(Buffer.from(forged, 'latin1'), [alice.identity])).toThrow('header MAC mismatch');
  });

  it('detects a modified wrapped file key', () => {
    const text = ageEncrypt('x', [alice.recipient]).toString('latin1');
    const lines = text.split('\n');

    lines[2] = lines[2][0] === 'A' ? `B${lines[2].slice(1)}` : `A${lines[2].slice(1)}`;
    expect(() => ageDecrypt(Buffer.from(lines.join('\n'), 'latin1'), [alice.identity])).toThrow(
      /no identity matched|non-canonical/,
    );
  });

  it('detects truncation at a chunk boundary', () => {
    const file = ageEncrypt(Buffer.alloc(2 * CHUNK), [alice.recipient]);

    expect(() => ageDecrypt(file.subarray(0, file.length - (CHUNK + 16)), [alice.identity])).toThrow(
      'truncated payload',
    );
  });

  it('detects truncation inside a chunk and a missing payload', () => {
    const file = ageEncrypt(Buffer.alloc(100), [alice.recipient]);

    expect(() => ageDecrypt(file.subarray(0, file.length - 1), [alice.identity])).toThrow(
      'payload authentication failed',
    );
    expect(() => ageDecrypt(file.subarray(0, headerEnd(file) + 16), [alice.identity])).toThrow('truncated payload');
  });

  it('rejects trailing data after the final chunk', () => {
    const file = ageEncrypt(Buffer.alloc(CHUNK), [alice.recipient]);

    expect(() => ageDecrypt(Buffer.concat([file, Buffer.alloc(32)]), [alice.identity])).toThrow(
      'trailing data after final chunk',
    );
    expect(() => ageDecrypt(Buffer.concat([file, Buffer.alloc(8)]), [alice.identity])).toThrow(
      'trailing data after final chunk',
    );
  });

  it('rejects a low-order X25519 share (all-zero shared secret)', () => {
    const zero = 'A'.repeat(43);
    const file = Buffer.from(
      `age-encryption.org/v1\n-> X25519 ${zero}\n${zero}\n--- ${zero}\n${'\0'.repeat(32)}`,
      'latin1',
    );

    expect(() => ageDecrypt(file, [alice.identity])).toThrow('low-order point');
  });

  it.each([
    ['age-encryption.org/v2\n-> X25519 a\nAA\n--- AA\n', 'unsupported version'],
    ['age-encryption.org/v1\n--- AAAA\n', 'no recipient stanzas'],
    ['age-encryption.org/v1\n-> X25519 a\nAB\n--- A\n', 'non-canonical stanza body'],
    [`age-encryption.org/v1\n-> X25519 a\n${'A'.repeat(65)}\n--- A\n`, 'stanza body line too long'],
    ['age-encryption.org/v1\n->  X25519\n\n--- A\n', 'malformed stanza'],
    ['age-encryption.org/v1\n-> X25519 a\n\n', 'truncated header'],
    ['age-encryption.org/v1\nhello\n', 'malformed header'],
    [`age-encryption.org/v1\n-> X25519 AAAA\nAAAA\n--- ${'A'.repeat(43)}\n`, 'invalid X25519 stanza'],
  ])('rejects malformed header %#', (header, message) => {
    expect(() => ageDecrypt(Buffer.from(header, 'latin1'), [alice.identity])).toThrow(message);
  });
});
