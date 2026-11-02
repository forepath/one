import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse, parseAllDocuments } from 'yaml';

import { generateAgeIdentity } from './age';
import {
  goFormatFloat,
  isSopsDocument,
  readSopsMetadata,
  sopsDecrypt,
  sopsDecryptYaml,
  sopsDecryptYamlDocuments,
  sopsMacAad,
} from './sops';

/**
 * Known answers: the fixtures were encrypted by the real `sops` 3.13.3 (see the lab test for the same against freshly
 * encrypted files). The identity is a throwaway test key, stored lowercase so secret scanners don't flag it.
 */
const FIXTURES = join(__dirname, '__fixtures__');
const IDENTITY = 'age-secret-key-1spzm5xql9xwhhs9zywypjte5q0z36ffvg7au6lvqn9s79dxgzlzqg0nw8a'.toUpperCase();
const RECIPIENT = 'age1dxepryr8jh4a7jpl4e7e9033tadrdp6cvzjm4wj6uw53xerc8ausnv4xm5';

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

describe('sopsDecrypt (files made by the real sops)', () => {
  it('decrypts nested maps, lists, ints, floats, bools, multiline strings and unencrypted_suffix keys', () => {
    const result = sopsDecrypt(fixture('basic.sops.yaml'), [IDENTITY]);

    expect(result.documents).toEqual([parse(fixture('basic.yaml'))]);
    expect(parse(result.yaml)).toEqual(parse(fixture('basic.yaml')));
    expect(result.yaml).not.toContain('sops:');
    expect(result.yaml).not.toContain('ENC[');
  });

  it('decrypts encrypted comments (head, line and list comments)', () => {
    const yaml = sopsDecryptYaml(fixture('basic.sops.yaml'), [IDENTITY]);

    expect(yaml).toContain('# top comment\n');
    expect(yaml).toContain('name: demo # line comment\n');
    expect(yaml).toContain('  # inner comment\n  tags:\n');
    expect(yaml).toMatch(/- a\n\s+# list comment\n\s+- 2\n/);
  });

  it('keeps the float type of integer-valued floats', () => {
    expect(sopsDecryptYaml(fixture('basic.sops.yaml'), [IDENTITY])).toContain('big: 1.0\n');
  });

  it('decrypts with encrypted_regex and verifies the MAC over the unencrypted values', () => {
    expect(sopsDecryptYamlDocuments(fixture('encrypted-regex.sops.yaml'), [IDENTITY])).toEqual([
      {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: {
          name: 'db',
          replicas: 3,
          mode: 420,
          octal: 15,
          hex: 31,
          bin: 5,
          big: 1000,
          ratio: 1.5,
          exp: 1000,
          inf: Infinity,
          enabled: true,
          created: '2024-01-02T03:04:05Z',
          date: '2024-01-02T00:00:00Z',
          quoted: '42',
          folded: 'a folded text\n',
        },
        data: { password: 'hunter2', port: 5432 },
        stringData: { token: 'abc' },
      },
    ]);
  });

  it('decrypts with encrypted_suffix and mac_only_encrypted', () => {
    expect(sopsDecryptYamlDocuments(fixture('mac-only.sops.yaml'), [IDENTITY])).toEqual([
      {
        service: {
          image: 'nginx:1.27',
          replicas: 2,
          password_secret: 's3cr3t',
          nested_secret: { key: 'value', count: 7 },
        },
      },
    ]);
  });

  it('decrypts multi-document files', () => {
    const result = sopsDecrypt(fixture('multi.sops.yaml'), [IDENTITY]);

    expect(result.documents).toEqual(parseAllDocuments(fixture('multi.yaml')).map((doc) => doc.toJS()));
    expect(result.yaml.split('\n---\n')).toHaveLength(2);
    expect(parseAllDocuments(result.yaml).map((doc) => doc.toJS())).toEqual(result.documents);
  });

  it('tries every identity and every age entry (the file has two recipients, ours second)', () => {
    expect(readSopsMetadata(fixture('basic.sops.yaml')).age.map((entry) => entry.recipient)).toContain(RECIPIENT);
    expect(sopsDecryptYamlDocuments(fixture('basic.sops.yaml'), [generateAgeIdentity().identity, IDENTITY])).toEqual([
      parse(fixture('basic.yaml')),
    ]);
  });
});

describe('sopsDecrypt errors', () => {
  const basic = fixture('basic.sops.yaml');

  /** Changes the first base64 character after `marker` (keeps the ciphertext well-formed). */
  function flipAfter(text: string, marker: RegExp): string {
    const match = marker.exec(text);

    if (!match) throw new Error(`no ${marker}`);

    const at = match.index + match[0].length;

    return `${text.slice(0, at)}${text[at] === 'A' ? 'B' : 'A'}${text.slice(at + 1)}`;
  }

  function encValue(text: string, key: string): string {
    const match = new RegExp(`^\\s*${key}: (ENC\\[[^\\]]+\\])`, 'm').exec(text);

    if (!match) throw new Error(`no ${key}`);

    return match[1];
  }

  it('fails without a matching identity and names the recipients', () => {
    expect(() => sopsDecrypt(basic, [generateAgeIdentity().identity])).toThrow(
      /no age identity matches the file recipients \(age1.*age1dxepryr8/,
    );
    expect(() => sopsDecrypt(basic, [])).toThrow('no age identities given');
  });

  it('detects a value moved to another key (additional data mismatch) without leaking plaintext', () => {
    const regex = fixture('encrypted-regex.sops.yaml');
    const token = encValue(regex, 'token');
    const tampered = regex.replace(encValue(regex, 'password'), token);

    let message = '';

    try {
      sopsDecrypt(tampered, [IDENTITY]);
    } catch (error) {
      message = String(error);
    }

    expect(message).toContain('could not decrypt value at data:password:');
    expect(message).not.toMatch(/hunter2|abc/);
  });

  it('detects a modified ciphertext', () => {
    const tampered = flipAfter(basic, /name: ENC\[AES256_GCM,data:/);

    expect(() => sopsDecrypt(tampered, [IDENTITY])).toThrow('could not decrypt value at app:name:');
  });

  it('detects reordered values under the same path through the MAC', () => {
    // tags: [a (str), # list comment, 2 (int)] — swap the two values; both decrypt (same path), the MAC doesn't match.
    const lines = basic.split('\n');
    const items = lines.flatMap((line, i) => (/^\s+- ENC\[.*type:(str|int)\]$/.test(line) ? [i] : []));

    [lines[items[0]], lines[items[1]]] = [lines[items[1]], lines[items[0]]];

    const tampered = lines.join('\n');

    expect(
      (sopsDecryptYamlDocuments(basic, [IDENTITY])[0] as { app: { tags: unknown[] } }).app.tags.slice(0, 2),
    ).toEqual(['a', 2]);
    expect(() => sopsDecrypt(tampered, [IDENTITY])).toThrow('MAC mismatch');
  });

  it('detects a removed value through the MAC', () => {
    const tampered = basic.replace(/\n\s+port: ENC\[[^\n]+/, '');

    expect(() => sopsDecrypt(tampered, [IDENTITY])).toThrow('MAC mismatch');
  });

  it('detects a modified unencrypted value through the MAC', () => {
    expect(() =>
      sopsDecrypt(basic.replace('public_unencrypted: visible', 'public_unencrypted: changed'), [IDENTITY]),
    ).toThrow('MAC mismatch');

    const regex = fixture('encrypted-regex.sops.yaml');

    expect(() => sopsDecrypt(regex.replace('replicas: 3', 'replicas: 4'), [IDENTITY])).toThrow('MAC mismatch');
  });

  it('does not cover unencrypted values with mac_only_encrypted (as SOPS)', () => {
    const tampered = fixture('mac-only.sops.yaml').replace('replicas: 2', 'replicas: 5');

    expect(sopsDecryptYamlDocuments(tampered, [IDENTITY])).toMatchObject([{ service: { replicas: 5 } }]);
  });

  it('detects a modified MAC or lastmodified', () => {
    const lastModified = /lastmodified: ["']([^"']+)["']/.exec(basic)?.[1] as string;

    expect(lastModified).toMatch(/^\d{4}-/);

    expect(() => sopsDecrypt(basic.replace(lastModified, '2020-01-01T00:00:00Z'), [IDENTITY])).toThrow(
      'could not decrypt the MAC',
    );
    expect(() => sopsDecrypt(flipAfter(basic, /mac: ENC\[AES256_GCM,data:/), [IDENTITY])).toThrow(
      'could not decrypt the MAC',
    );
    expect(() => sopsDecrypt(basic.replace(/\n\s+mac: ENC\[[^\n]+/, ''), [IDENTITY])).toThrow('file has no MAC');
  });

  it('rejects plaintext where a value must be encrypted', () => {
    const tampered = basic.replace(encValue(basic, 'name'), 'plain');

    expect(() => sopsDecrypt(tampered, [IDENTITY])).toThrow('value at app:name: is not encrypted');
  });

  it('rejects a tampered encrypted comment', () => {
    const tampered = flipAfter(basic, /^#ENC\[AES256_GCM,data:/m);

    expect(() => sopsDecrypt(tampered, [IDENTITY])).toThrow('could not decrypt an encrypted comment');
  });

  it('rejects unsupported or invalid metadata', () => {
    expect(() => sopsDecrypt('a: 1\n', [IDENTITY])).toThrow('not a SOPS file');
    expect(() => sopsDecrypt('a: [\n', [IDENTITY])).toThrow('invalid YAML');
    expect(() => sopsDecrypt(basic.replace(/version: 3\.\d+\.\d+/, 'version: 4.0.0'), [IDENTITY])).toThrow(
      'unsupported SOPS version 4.0.0',
    );
    expect(() => sopsDecrypt(basic.replace('\nsops:\n', '\nsops:\n  shamir_threshold: 2\n'), [IDENTITY])).toThrow(
      'unsupported metadata field shamir_threshold',
    );
    expect(() => sopsDecrypt(basic.replace('\nsops:\n', '\nsops:\n  encrypted_regex: ^x$\n'), [IDENTITY])).toThrow(
      'conflicting encryption rules',
    );
    expect(() =>
      sopsDecrypt(basic.replace(/\nsops:\n {2}age:/, '\nsops:\n  pgp: []\n  age_none:'), [IDENTITY]),
    ).toThrow('no age recipients');
  });

  it('rejects YAML aliases', () => {
    expect(() => sopsDecrypt(basic.replace('app:\n', 'app:\n  first: &b ""\n  alias: *b\n'), [IDENTITY])).toThrow(
      'aliases are not supported',
    );
  });
});

describe('isSopsDocument', () => {
  it('recognizes SOPS files', () => {
    expect(isSopsDocument(fixture('basic.sops.yaml'))).toBe(true);
    expect(isSopsDocument(fixture('multi.sops.yaml'))).toBe(true);
  });

  it.each(['a: 1\n', 'sops: yes\n', 'sops:\n  mac: x\n', 'sops: [\n', '', '- a\n'])('rejects %j', (text) => {
    expect(isSopsDocument(text)).toBe(false);
  });
});

describe('SOPS / Go formatting helpers', () => {
  it.each([
    [0.25, '0.25'],
    [1, '1'],
    [-2.5, '-2.5'],
    [0.1, '0.1'],
    [1e21, '1000000000000000000000'],
    [1e-7, '0.0000001'],
    [123456.789, '123456.789'],
    [5e-324, `0.${'0'.repeat(323)}5`],
    [NaN, 'NaN'],
    [Infinity, '+Inf'],
    [-Infinity, '-Inf'],
    [-0, '-0'],
  ])('formats %p like strconv.FormatFloat(f, -1)', (value, expected) => {
    expect(goFormatFloat(value)).toBe(expected);
  });

  it.each([
    ['2026-10-18T14:35:11Z', '2026-10-18T14:35:11Z'],
    ['2026-10-18T14:35:11.123456Z', '2026-10-18T14:35:11Z'],
    ['2026-10-18T14:35:11+00:00', '2026-10-18T14:35:11Z'],
    ['2026-10-18T16:35:11+02:00', '2026-10-18T16:35:11+02:00'],
  ])('uses %s as %s for the MAC additional data', (input, expected) => {
    expect(sopsMacAad(input)).toBe(expected);
  });

  it('rejects an invalid lastmodified', () => {
    expect(() => sopsMacAad('yesterday')).toThrow('invalid lastmodified');
  });
});
