import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';

import { parse, parseAllDocuments } from 'yaml';

import { ageDecrypt, ageEncrypt, ageRecipientOf, generateAgeIdentity, parseAgeIdentities } from '../lib/age';
import { isSopsDocument, readSopsMetadata, sopsDecrypt } from '../lib/sops';

import { SOPS_LAB_IMAGE } from './lab.global-setup';

/**
 * age / SOPS interoperability against the real binaries (3.29): files made by `age` and `sops` are decrypted here,
 * files made here are decrypted by `age`. Data goes through stdin / stdout (no bind mounts: Docker's host may not be
 * this host); keys go through the environment, never through argv.
 */

function lab(script: string, options: { input?: Buffer | string; env?: Record<string, string> } = {}): Buffer {
  const env = options.env ?? {};

  return execFileSync(
    'docker',
    ['run', '--rm', '-i', ...Object.keys(env).flatMap((name) => ['-e', name]), SOPS_LAB_IMAGE, 'sh', '-c', script],
    { input: options.input ?? '', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024, stdio: 'pipe' },
  );
}

function sshEd25519Recipient(): string {
  const raw = (generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(12);
  const field = (data: Buffer) => Buffer.concat([Buffer.from([0, 0, 0, data.length]), data]);

  return `ssh-ed25519 ${Buffer.concat([field(Buffer.from('ssh-ed25519')), field(raw)]).toString('base64')}`;
}

function sopsEncrypt(yaml: string, recipient: string, config?: string): string {
  return lab(
    'set -e; mkdir -p /tmp/w; cd /tmp/w; [ -n "$CONFIG" ] && printf "%s\\n" "$CONFIG" > .sops.yaml; ' +
      'cat > in.yaml; if [ -n "$CONFIG" ]; then sops encrypt in.yaml; else sops encrypt --age "$RECIPIENT" in.yaml; fi',
    { input: yaml, env: { RECIPIENT: recipient, CONFIG: config ?? '' } },
  ).toString('utf8');
}

function sopsDecryptReal(encrypted: string, identity: string): string {
  return lab('set -e; cat > /tmp/in.yaml; sops decrypt /tmp/in.yaml', {
    input: encrypted,
    env: { SOPS_AGE_KEY: identity },
  }).toString('utf8');
}

const PLAIN = `# Database settings
database:
  host: db.internal # primary
  port: 5432
  ratio: 0.75
  weight: 2.0
  negative: -12
  enabled: true
  disabled: false
  empty: ""
  missing: null
  unicode: "grüße, 世界"
  password: "p@ss: w0rd # not a comment"
  multiline: |
    first line
    second line
  folded: >-
    folded
    text
  # replicas and their zones
  replicas:
    - name: a
      zone: eu-1
    - name: b
      # second zone
      zone: eu-2
  ports:
    - 80
    # TLS
    - 443
  matrix:
    - [1, 2]
    - [true, 3.5]
  host_unencrypted: visible.example
  public_unencrypted:
    note: also visible
    list: [1, two]
`;

describe('age / SOPS interoperability (lab)', () => {
  const ours = generateAgeIdentity();
  let real: { identity: string; recipient: string };

  beforeAll(() => {
    const identity = parseAgeIdentities(lab('age-keygen 2>/dev/null').toString('utf8'))[0];

    real = {
      identity,
      recipient: lab('age-keygen -y', { input: `${identity}\n` })
        .toString('utf8')
        .trim(),
    };
  }, 300_000);

  describe('age', () => {
    it('derives the same recipients as age-keygen', () => {
      expect(ageRecipientOf(real.identity)).toBe(real.recipient);
      expect(
        lab('age-keygen -y', { input: `${ours.identity}\n` })
          .toString('utf8')
          .trim(),
      ).toBe(ours.recipient);
    });

    it('decrypts binary and armored files made by age', () => {
      const plaintext = Buffer.alloc(200_000);

      for (let i = 0; i < plaintext.length; i++) plaintext[i] = (i * 7) & 0xff;

      const binary = lab('age -r "$R"', { input: plaintext, env: { R: ours.recipient } });
      const armored = lab('age -a -r "$R"', { input: 'armored\n', env: { R: ours.recipient } }).toString('utf8');

      expect(ageDecrypt(binary, [ours.identity]).equals(plaintext)).toBe(true);
      expect(armored.startsWith('-----BEGIN AGE ENCRYPTED FILE-----\n')).toBe(true);
      expect(ageDecrypt(armored, [ours.identity]).toString()).toBe('armored\n');
    });

    it('decrypts empty and exact-chunk files made by age', () => {
      const empty = lab('age -r "$R"', { env: { R: ours.recipient } });
      const chunk = Buffer.alloc(64 * 1024, 1);

      expect(ageDecrypt(empty, [ours.identity])).toHaveLength(0);
      expect(
        ageDecrypt(lab('age -r "$R"', { input: chunk, env: { R: ours.recipient } }), [ours.identity]).equals(chunk),
      ).toBe(true);
    });

    it('finds its stanza among several recipients and other stanza types', () => {
      const file = lab('age -r "$SSH" -r "$OTHER" -r "$R"', {
        input: 'mixed\n',
        env: { SSH: sshEd25519Recipient(), OTHER: real.recipient, R: ours.recipient },
      });

      expect(file.toString('latin1')).toContain('-> ssh-ed25519 ');
      expect(ageDecrypt(file, [ours.identity]).toString()).toBe('mixed\n');
      expect(ageDecrypt(file, [real.identity]).toString()).toBe('mixed\n');
    });

    it('fails on a wrong identity and on tampering', () => {
      const file = lab('age -r "$R"', { input: 'secret\n', env: { R: ours.recipient } });

      expect(() => ageDecrypt(file, [generateAgeIdentity().identity])).toThrow('no identity matched');

      const tampered = Buffer.from(file);

      tampered[tampered.length - 2] ^= 0x01;
      expect(() => ageDecrypt(tampered, [ours.identity])).toThrow('payload authentication failed');
    });

    it('writes files the real age decrypts (binary, armored, multi-chunk, several recipients)', () => {
      const plaintext = Buffer.alloc(150_000, 9);
      const env = { ID: real.identity };
      const decrypt = 'set -e; printf "%s\\n" "$ID" > /tmp/k; age -d -i /tmp/k';

      expect(lab(decrypt, { input: ageEncrypt(plaintext, [real.recipient]), env }).equals(plaintext)).toBe(true);
      expect(
        lab(decrypt, {
          input: ageEncrypt('armored', [ours.recipient, real.recipient], { armor: true }),
          env,
        }).toString(),
      ).toBe('armored');
      expect(lab(decrypt, { input: ageEncrypt('', [real.recipient]), env })).toHaveLength(0);
      expect(lab(decrypt, { input: ageEncrypt(Buffer.alloc(64 * 1024, 2), [real.recipient]), env })).toHaveLength(
        64 * 1024,
      );
    });
  });

  describe('sops', () => {
    it('decrypts a file encrypted by sops (types, nesting, comments, unencrypted_suffix) like sops does', () => {
      const encrypted = sopsEncrypt(PLAIN, ours.recipient);

      expect(isSopsDocument(encrypted)).toBe(true);
      expect(encrypted).not.toContain('5432');
      expect(encrypted).toContain('host_unencrypted: visible.example');
      expect(readSopsMetadata(encrypted).unencryptedSuffix).toBe('_unencrypted');

      const result = sopsDecrypt(encrypted, [ours.identity]);

      expect(result.documents).toEqual([parse(PLAIN)]);
      expect(parse(result.yaml)).toEqual(parse(sopsDecryptReal(encrypted, ours.identity)));

      for (const comment of [
        '# Database settings',
        '# primary',
        '# replicas and their zones',
        '# second zone',
        '# TLS',
      ]) {
        expect(result.yaml).toContain(comment);
      }

      expect(result.yaml).toContain('weight: 2.0');
      expect(result.yaml).not.toContain('ENC[');
      expect(result.yaml).not.toContain('sops:');
    });

    it('decrypts encrypted_regex and mac_only_encrypted files', () => {
      const secret = `apiVersion: v1\nkind: Secret\nmetadata:\n  name: db\n  labels:\n    tier: "3"\n  replicas: 3\ndata:\n  password: c2VjcmV0\nstringData:\n  token: abc\n`;
      const regex = sopsEncrypt(
        secret,
        ours.recipient,
        `creation_rules:\n  - age: ${ours.recipient}\n    encrypted_regex: '^(data|stringData)$'`,
      );
      const macOnly = sopsEncrypt(
        secret,
        ours.recipient,
        `creation_rules:\n  - age: ${ours.recipient}\n    encrypted_regex: '^(data|stringData)$'\n    mac_only_encrypted: true`,
      );

      expect(regex).toContain('name: db');
      expect(regex).not.toContain('c2VjcmV0');
      expect(sopsDecrypt(regex, [ours.identity]).documents).toEqual([parse(secret)]);
      expect(readSopsMetadata(macOnly).macOnlyEncrypted).toBe(true);
      expect(sopsDecrypt(macOnly, [ours.identity]).documents).toEqual([parse(secret)]);
    });

    it('decrypts multi-document files', () => {
      const multi = `kind: A\nvalue: 1\n---\nkind: B\nitems:\n  - secret: two\n`;
      const result = sopsDecrypt(sopsEncrypt(multi, ours.recipient), [ours.identity]);

      expect(result.documents).toEqual(parseAllDocuments(multi).map((doc) => doc.toJS()));
    });

    it('uses the right age entry with several recipients', () => {
      const encrypted = sopsEncrypt(
        'a: 1\n',
        ours.recipient,
        `creation_rules:\n  - age: ${real.recipient},${ours.recipient}`,
      );

      expect(readSopsMetadata(encrypted).age).toHaveLength(2);
      expect(sopsDecrypt(encrypted, [ours.identity]).documents).toEqual([{ a: 1 }]);
      expect(sopsDecrypt(encrypted, [real.identity]).documents).toEqual([{ a: 1 }]);
    });

    it('rejects a wrong identity, tampered values and tampered unencrypted values', () => {
      const encrypted = sopsEncrypt(PLAIN, ours.recipient);

      expect(() => sopsDecrypt(encrypted, [generateAgeIdentity().identity])).toThrow('no age identity matches');

      const portLine = /\n(\s+)port: (ENC\[[^\n]+)/.exec(encrypted) as RegExpExecArray;
      const ratioValue = (/\n\s+ratio: (ENC\[[^\n]+)/.exec(encrypted) as RegExpExecArray)[1];
      const swapped = encrypted.replace(portLine[2], ratioValue);

      expect(() => sopsDecrypt(swapped, [ours.identity])).toThrow('could not decrypt value at database:port:');
      expect(() =>
        sopsDecrypt(encrypted.replace('host_unencrypted: visible.example', 'host_unencrypted: evil.example'), [
          ours.identity,
        ]),
      ).toThrow('MAC mismatch');
      // sops agrees.
      expect(() =>
        sopsDecryptReal(
          encrypted.replace('host_unencrypted: visible.example', 'host_unencrypted: evil.example'),
          ours.identity,
        ),
      ).toThrow();
    });
  });
});
