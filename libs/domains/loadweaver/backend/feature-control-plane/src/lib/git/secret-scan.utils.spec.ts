import { describeFindings, entropy, isSopsDocument, isSopsValue, scanFiles, scanForSecrets } from './secret-scan.utils';

// Test tokens are assembled at runtime so this file doesn't trip the repository's own secret scanning.
const join = (...parts: string[]) => parts.join('');
const alnum = (n: number, seed = 7) =>
  Array.from({ length: n }, (_, i) => 'aB3dE5fG7hJ9kL2mN4pQ6rS8tU0vW1xYz'[(i * seed + 3) % 33]).join('');

const TOKENS: [string, string][] = [
  ['github-token', join('gh', 'p_', alnum(36))],
  ['github-token', join('github', '_pat_', alnum(82, 5))],
  ['gitlab-token', join('glp', 'at-', alnum(20))],
  ['aws-access-key-id', join('AK', 'IA', 'Q3EGRDXMPLE7ZKXA')],
  ['slack-token', join('xo', 'xb-', '1234567890-', alnum(24))],
  ['slack-webhook', join('https://hooks.slack.com/services/', 'T0123ABCD/', 'B0123ABCD/', alnum(24))],
  ['stripe-key', join('sk', '_live_', alnum(24))],
  ['google-api-key', join('AI', 'za', alnum(35, 11))],
  ['npm-token', join('np', 'm_', alnum(36, 13))],
  ['anthropic-key', join('sk-', 'ant-', 'api03-', alnum(40))],
  ['jwt', join('ey', 'JhbGciOiJIUzI1NiJ9', '.ey', 'JzdWIiOiIxMjM0NTY3ODkwIn0', '.', alnum(43))],
  ['bearer-token', join('Authorization: Bear', 'er ', alnum(40))],
];

describe('secret scanning', () => {
  it.each(TOKENS)('finds %s tokens by format', (rule, token) => {
    const findings = scanForSecrets('apps/web.yaml', `kind: Deployment\nspec:\n  compose: |\n    x: ${token}\n`);

    expect(findings).toEqual([{ file: 'apps/web.yaml', line: 4, rule }]);
  });

  it('finds private key blocks', () => {
    const pem = join('-----BEGIN OPENSSH ', 'PRIVATE KEY-----\n', alnum(64), '\n-----END OPENSSH PRIVATE KEY-----');

    expect(scanForSecrets('k.yaml', `spec:\n  key: |\n    ${pem.replace(/\n/g, '\n    ')}\n`)).toEqual([
      { file: 'k.yaml', line: 3, rule: 'private-key' },
    ]);
    expect(scanForSecrets('k.yaml', join('-----BEGIN RSA ', 'PRIVATE KEY-----'))[0].rule).toBe('private-key');
    expect(scanForSecrets('k.yaml', join('-----BEGIN ', 'PRIVATE KEY-----'))[0].rule).toBe('private-key');
  });

  it('finds credential-named keys with literal high-entropy values (YAML, env lists, JSON, camelCase)', () => {
    const value = join('Zt4', alnum(14, 5), '!q');
    const text = [
      'services:',
      '  db:',
      '    environment:',
      `      POSTGRES_PASSWORD: ${value}`,
      `      - API_TOKEN=${value}`,
      `    adminPassword: "${value}"`,
      `    "client_secret": "${value}",`,
      `    db.password = ${value}`,
    ].join('\n');

    expect(scanForSecrets('c.yaml', text).map((f) => [f.line, f.rule])).toEqual([
      [4, 'credential-value'],
      [5, 'credential-value'],
      [6, 'credential-value'],
      [7, 'credential-value'],
      [8, 'credential-value'],
    ]);
  });

  it('finds literal credentials in URLs', () => {
    expect(scanForSecrets('c.yaml', `DATABASE_URL: postgres://app:${join('s3cr', 'etPassw0rd')}@db:5432/app`)).toEqual([
      { file: 'c.yaml', line: 1, rule: 'url-credentials' },
    ]);
  });

  it('accepts secret references, SOPS values, digests, public keys, certificates and placeholders', () => {
    const text = [
      'apiVersion: loadweaver.com/v1',
      'kind: Deployment',
      'metadata: { name: web, project: shop }',
      'spec:',
      '  compose: |',
      '    services:',
      '      web:',
      `        image: ghcr.io/acme/web@sha256:${'a1'.repeat(32)}`,
      '        environment:',
      '          DB_PASSWORD_FILE: /run/secrets/db-password',
      '          DB_PASSWORD: ${DB_PASSWORD}',
      '          API_TOKEN: <set-me>',
      '          TOKEN_URL: https://auth.example.com/oauth/token',
      '          SECRET_NAME: db-password',
      '          PASSWORD: changeme',
      '          DATABASE_URL: postgres://app:${DB_PASSWORD}@db:5432/app',
      '        secrets: [db-password]',
      '    secrets:',
      '      db-password:',
      '        external: true',
      '        x-loadweaver: { ref: "secret://shop/db-password" }',
      '  password: secret://shop/db-password',
      '  apiToken: secret://shop/api-token@3',
      `  wireguardPublicKey: ${'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk='}`,
      `  sshPublicKey: ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${alnum(43)} ops@example`,
      '  certificate: |',
      '    -----BEGIN CERTIFICATE-----',
      `    MIIBszCCAVmgAwIBAgIU${alnum(40)}`,
      '    -----END CERTIFICATE-----',
      `  tokenTtl: 3600`,
      `  secretRotation: 30d`,
      `  password: ENC[AES256_GCM,data:${alnum(20)},iv:${alnum(22)},tag:${alnum(22)},type:str]`,
      'sops:',
      '  age:',
      `    - recipient: age1${alnum(58).toLowerCase()}`,
      '      enc: |',
      '        -----BEGIN AGE ENCRYPTED FILE-----',
      `        YWdlLWVuY3J5cHRpb24ub3JnL3YxCi0+IFgyNTUxOSB${alnum(40)}`,
      '        -----END AGE ENCRYPTED FILE-----',
      `  mac: ENC[AES256_GCM,data:${alnum(40)},iv:${alnum(22)},tag:${alnum(22)},type:str]`,
      '  version: 3.9.0',
    ].join('\n');

    expect(scanForSecrets('ok.yaml', text)).toEqual([]);
  });

  it('does not flag low-entropy words or ordinary configuration', () => {
    expect(scanForSecrets('a.yaml', 'password: correcthorse\ntoken_endpoint: /oauth/token\nsecret: true\n')).toEqual(
      [],
    );
    expect(scanForSecrets('a.yaml', `token: ${'a'.repeat(30)}\n`)).toEqual([]);
  });

  it('reports file, line and rule, never the value', () => {
    const token = join('gh', 'p_', alnum(36));
    const findings = scanFiles([
      { path: 'a.yaml', text: 'ok: 1\n' },
      { path: 'b.yaml', text: `x: 1\ny: ${token}\n` },
    ]);
    const reason = describeFindings(findings);

    expect(findings).toEqual([{ file: 'b.yaml', line: 2, rule: 'github-token' }]);
    expect(reason).toContain('b.yaml:2 (github-token)');
    expect(reason).not.toContain(token);
    expect(describeFindings(Array.from({ length: 25 }, (_, i) => ({ file: 'f', line: i + 1, rule: 'jwt' })))).toContain(
      'and 5 more',
    );
  });

  it('measures entropy', () => {
    expect(entropy('')).toBe(0);
    expect(entropy('aaaa')).toBe(0);
    expect(entropy('abcd')).toBe(2);
  });

  describe('bypasses (L1)', () => {
    const value = join('Zt4', alnum(14, 5), '!q');
    const enc = `ENC[AES256_GCM,data:${alnum(20)},iv:${alnum(22)},tag:${alnum(22)},type:str]`;

    it('skips only values that are exactly SOPS ciphertext', () => {
      expect(isSopsValue(enc)).toBe(true);
      expect(isSopsValue(`${enc} ${value}`)).toBe(false);
      expect(isSopsValue('ENC[not really]')).toBe(false);
      // A line that merely mentions ENC[AES256_GCM, is scanned like any other.
      expect(scanForSecrets('a.yaml', `password: "ENC[AES256_GCM,${value}"`)).toEqual([
        { file: 'a.yaml', line: 1, rule: 'credential-value' },
      ]);
      expect(scanForSecrets('a.yaml', `note: ${enc} ${join('gh', 'p_', alnum(36))}`)[0]?.rule).toBe('github-token');
      expect(scanForSecrets('a.yaml', `password: ${enc}`)).toEqual([]);
    });

    it('skips a top-level `sops:` block only in real SOPS files', () => {
      const fake = [
        'kind: Deployment',
        'sops:',
        `  password: ${value}`,
        `  token: ${join('gh', 'p_', alnum(36))}`,
      ].join('\n');

      expect(scanForSecrets('fake.yaml', fake).map((f) => f.line)).toEqual([3, 4]);

      // Looks like SOPS metadata, but carries a non-SOPS key: still scanned.
      const disguised = ['sops:', `  mac: ${enc}`, '  version: 3.9.0', `  password: ${value}`].join('\n');

      expect(scanForSecrets('disguised.yaml', disguised).map((f) => f.line)).toEqual([4]);
      expect(isSopsDocument(disguised)).toBe(false);

      const real = [
        `password: ${enc}`,
        'sops:',
        '  age:',
        `    - recipient: age1${alnum(58).toLowerCase()}`,
        '      enc: |',
        '        -----BEGIN AGE ENCRYPTED FILE-----',
        `        ${alnum(60)}`,
        '        -----END AGE ENCRYPTED FILE-----',
        `  mac: ${enc}`,
        '  version: 3.13.0',
      ].join('\n');

      expect(scanForSecrets('real.yaml', real)).toEqual([]);
    });

    it('finds secrets in block scalars of credential-named keys', () => {
      expect(scanForSecrets('b.yaml', ['spec:', '  password: |', `    ${value}`, '  other: 1'].join('\n'))).toEqual([
        { file: 'b.yaml', line: 3, rule: 'credential-value' },
      ]);
      expect(scanForSecrets('b.yaml', ['apiToken: >-', `  ${value}`].join('\n'))[0]?.line).toBe(2);
      // Ordinary block scalars and harmless block contents stay quiet.
      expect(
        scanForSecrets(
          'b.yaml',
          ['description: |', `  ${value}`, 'password: |', '  secret://shop/db-password', 'token: |', '  changeme'].join(
            '\n',
          ),
        ),
      ).toEqual([]);
    });

    it('finds the data of Kubernetes Secrets, whatever the keys', () => {
      const secret = [
        'apiVersion: v1',
        'kind: Secret',
        'metadata:',
        '  name: db',
        'data:',
        '  username: YWRtaW4=',
        `  conn: ${Buffer.from('postgres').toString('base64')}`,
        'stringData:',
        '  config: plain',
      ].join('\n');

      expect(scanForSecrets('s.yaml', secret).map((f) => [f.line, f.rule])).toEqual([
        [6, 'kubernetes-secret'],
        [7, 'kubernetes-secret'],
        [9, 'kubernetes-secret'],
      ]);
      // `data:` of other kinds (ConfigMaps, Loadweaver resources) is ordinary data; SOPS values are fine.
      expect(scanForSecrets('c.yaml', ['kind: ConfigMap', 'data:', '  username: YWRtaW4='].join('\n'))).toEqual([]);
      expect(scanForSecrets('s.yaml', ['kind: Secret', 'data:', `  password: ${enc}`].join('\n'))).toEqual([]);
      // Per document: a Secret in one document doesn't make another document's data secret.
      expect(
        scanForSecrets('m.yaml', ['kind: Secret', 'data: {}', '---', 'kind: ConfigMap', 'data:', '  a: b'].join('\n')),
      ).toEqual([]);
    });

    it('finds credentials in flow maps and one-line JSON', () => {
      expect(scanForSecrets('j.yaml', `config: '{"user": "app", "password": "${value}"}'`)).toEqual([
        { file: 'j.yaml', line: 1, rule: 'credential-value' },
      ]);
      expect(scanForSecrets('j.yaml', `db: { host: db, apiKey: ${value} }`)[0]?.rule).toBe('credential-value');
      expect(scanForSecrets('j.yaml', `db: { host: db, password: secret://shop/db, tokenUrl: https://x/y }`)).toEqual(
        [],
      );
      expect(scanForSecrets('j.yaml', `labels: { app: web, tier: ${value} }`)).toEqual([]);
    });
  });
});
