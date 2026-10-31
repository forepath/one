import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RELEASE_SIGNING_KEYS } from '@forepath/shared/shared/util-release-keys';

import {
  LOADWEAVER_ADMIN_CLAIM_TOKEN_PATTERN,
  LOADWEAVER_DEFAULT_TEARDOWN_GRACE_DAYS,
  LOADWEAVER_NGINX_IMAGE,
  LOADWEAVER_PROXY_BODY_LIMITS,
  LOADWEAVER_STARTUP_WINDOW_MS,
  LOADWEAVER_TEARDOWN_CONFIRMATION_REQUIRED,
  buildLoadweaverCloudFirewall,
  buildLoadweaverCloudInitConfigFromRequest,
  buildLoadweaverCloudInitUserData,
  buildLoadweaverConsoleRuntimeConfig,
  buildLoadweaverUpdateCommand,
  generateLoadweaverAdminClaimToken,
  isLoadweaverItem,
  loadweaverNodeName,
  loadweaverTeardownConfirmationError,
  loadweaverTeardownNotBefore,
  mapLoadweaverClusterHealth,
  resolveLoadweaverEmailSettings,
  resolveLoadweaverTeardownGraceDays,
} from './loadweaver.utils';

const CLAIM_TOKEN = `lwc_${'Zq9_-'.repeat(8)}abc`;
const CLAIM = { loadweaverAdminClaimToken: CLAIM_TOKEN };
const SSH_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq9kmBVhT4w3lKx7Dk0V9cZ2v8x1nTqXr1GqkqE4bYp (unnamed)';

function decode(userData: string): string {
  return Buffer.from(userData, 'base64').toString('utf8');
}

describe('loadweaver service kind', () => {
  describe('buildLoadweaverCloudInitConfigFromRequest', () => {
    it('builds the config from plan defaults without generating cluster secrets', () => {
      const config = buildLoadweaverCloudInitConfigFromRequest(
        { ...CLAIM, loadweaverVersion: '1.4.0', sshPublicKey: SSH_KEY, clusterName: 'Acme prod', defaultLocale: 'de' },
        'lw-a1b2',
        'spirde.com',
        {},
      );

      expect(config.host).toEqual({ hostname: 'lw-a1b2', fqdn: 'lw-a1b2.spirde.com', nodeName: 'lw-a1b2' });
      expect(config.release).toEqual({
        version: '1.4.0',
        baseUrl: 'https://github.com/forepath/one/releases/download',
        trustedKeys: RELEASE_SIGNING_KEYS.loadweaver,
      });
      // No console tag: the node takes the digest from the release's verified manifest.
      expect(config.console).toEqual({ defaultLocale: 'de' });
      expect(config.cluster).toEqual({ name: 'Acme prod', adminClaimToken: CLAIM_TOKEN });
      expect(JSON.stringify(config)).not.toMatch(/encryption|jwt|password/i);
    });

    it('falls back to the operator release version and base URL, and pins the console by digest', () => {
      const digest = `sha256:${'a'.repeat(64)}`;
      const config = buildLoadweaverCloudInitConfigFromRequest(
        { ...CLAIM, loadweaverConsoleImageDigest: digest },
        'lw-x',
        'example.com',
        {
          LOADWEAVER_CLOUD_RELEASE_VERSION: '2.0.0-beta.1',
          LOADWEAVER_CLOUD_RELEASE_BASE_URL: 'https://mirror.example.com/loadweaver/',
          LETS_ENCRYPT_EMAIL: 'ops@example.com',
        },
      );

      expect(config.release.version).toBe('2.0.0-beta.1');
      expect(config.release.baseUrl).toBe('https://mirror.example.com/loadweaver');
      expect(config.console.imageDigest).toBe(digest);
      expect(config.letsEncryptEmail).toBe('ops@example.com');
    });

    it('refuses missing or unsafe inputs', () => {
      expect(() => buildLoadweaverCloudInitConfigFromRequest({}, 'lw-x', 'example.com', {})).toThrow(
        'exact release version',
      );
      expect(() =>
        buildLoadweaverCloudInitConfigFromRequest({ loadweaverVersion: 'latest' }, 'lw-x', 'example.com', {}),
      ).toThrow('exact release version');
      expect(() =>
        buildLoadweaverCloudInitConfigFromRequest({ loadweaverVersion: '1.0.0' }, 'lw-x', 'example.com', {
          LOADWEAVER_CLOUD_RELEASE_BASE_URL: 'http://insecure.example.com',
        }),
      ).toThrow('plain https URL');
      expect(() =>
        buildLoadweaverCloudInitConfigFromRequest(
          { loadweaverVersion: '1.0.0', loadweaverConsoleImageDigest: 'latest' },
          'lw-x',
          'example.com',
          {},
        ),
      ).toThrow('sha256');
      expect(() =>
        buildLoadweaverCloudInitConfigFromRequest(
          { loadweaverVersion: '1.0.0', sshPublicKey: 'ssh-ed25519 AAAA"; rm -rf /' },
          'lw-x',
          'example.com',
          {},
        ),
      ).toThrow('SSH public key');
      expect(() =>
        buildLoadweaverCloudInitConfigFromRequest({ loadweaverVersion: '1.0.0' }, 'bad host', 'example.com', {}),
      ).toThrow('valid host name');
      expect(() =>
        buildLoadweaverCloudInitConfigFromRequest({ loadweaverVersion: '1.0.0' }, 'lw-x', 'example.com', {}),
      ).toThrow('admin claim token');
      expect(() =>
        buildLoadweaverCloudInitConfigFromRequest(
          { loadweaverVersion: '1.0.0', loadweaverAdminClaimToken: "lwc_'; reboot" },
          'lw-x',
          'example.com',
          {},
        ),
      ).toThrow('admin claim token');
    });

    it('generates high-entropy, shell-safe admin claim tokens', () => {
      const a = generateLoadweaverAdminClaimToken();

      expect(a).toMatch(LOADWEAVER_ADMIN_CLAIM_TOKEN_PATTERN);
      expect(a).not.toEqual(generateLoadweaverAdminClaimToken());
    });

    it('drops cluster names that are not safe to pass on the command line', () => {
      const config = buildLoadweaverCloudInitConfigFromRequest(
        { ...CLAIM, loadweaverVersion: '1.0.0', clusterName: "x'; reboot" },
        'lw-x',
        'example.com',
        {},
      );

      expect(config.cluster).toEqual({ adminClaimToken: CLAIM_TOKEN });
    });
  });

  it('derives a valid node name from the host name', () => {
    expect(loadweaverNodeName('LW_Prod.1')).toBe('lw-prod-1');
    expect(loadweaverNodeName('---')).toBe('n1');
  });

  describe('buildLoadweaverCloudInitUserData', () => {
    const config = buildLoadweaverCloudInitConfigFromRequest(
      { ...CLAIM, loadweaverVersion: '1.4.0', sshPublicKey: SSH_KEY, clusterName: 'Acme' },
      'lw-a1b2',
      'spirde.com',
      {},
    );
    const script = decode(buildLoadweaverCloudInitUserData(config));

    it('is valid bash', () => {
      expect(() => execFileSync('bash', ['-n'], { input: script })).not.toThrow();
      expect(() => execFileSync('bash', ['-n'], { input: buildLoadweaverUpdateCommand() })).not.toThrow();
    });

    it('verifies the signed release manifest before installing the agent', () => {
      const base = 'https://github.com/forepath/one/releases/download/v1.4.0';

      expect(script).toContain(`${base}/loadweaver-bundle-1.4.0.manifest.json`);
      expect(script).toContain(`${base}/loadweaver-bundle-1.4.0.manifest.sig`);
      expect(script).toContain('openssl dgst -sha256 -verify "$key" -signature');
      expect(script).toContain('.product == "loadweaver" and .version == $v');
      expect(script).toContain(RELEASE_SIGNING_KEYS.loadweaver[0].trim());
      expect(script).toContain(`${base}/loadweaver-agent-1.4.0-linux-$LW_ARCH`);
      expect(script).toContain('sha256sum -c -');
      expect(script.indexOf('LW_VERIFIED')).toBeLessThan(script.indexOf('install -m 0755 "$LW_WORK/loadweaver-agent"'));
    });

    it('bootstraps a single-node cluster and installs components and the agent unit from the local control plane', () => {
      expect(script).toContain('debian:12|debian:13|ubuntu:22.04|ubuntu:24.04');
      expect(script).toContain(`jq '.["live-restore"] = true'`);
      expect(script).toContain(
        "/usr/local/bin/loadweaver-agent bootstrap '--name' 'lw-a1b2' '--public-host' 'lw-a1b2.spirde.com' '--public-url' 'https://lw-a1b2.spirde.com' '--cluster-name' 'Acme' '--admin-claim-token-file' '/var/lib/loadweaver-cloud/admin-claim-token'",
      );
      expect(script).toContain('http://127.0.0.1:3400/api/install/components.sh');
      expect(script).toContain('http://127.0.0.1:3400/api/install/loadweaver-agent.service');
      expect(script).toContain('systemctl enable --now loadweaver-agent');
      expect(script.indexOf('loadweaver-agent bootstrap')).toBeLessThan(script.indexOf('components.sh'));
    });

    it("serves console and API on one TLS origin with a digest-pinned proxy and Let's Encrypt", () => {
      expect(script).toContain(`image: ${LOADWEAVER_NGINX_IMAGE}`);
      expect(script).toContain('network_mode: host');
      expect(script).toContain("'127.0.0.1:4602:4602'");
      expect(script).toContain('image: ${LOADWEAVER_CONSOLE_IMAGE}');
      expect(script).toContain('location /v2/ {');
      expect(script).toContain('proxy_pass http://127.0.0.1:3400;');
      expect(script).toContain('location /socket/');
      expect(script).toContain('certbot certonly --webroot -w /opt/loadweaver/certbot-webroot -d "$FQDN"');
      expect(script).toContain('ssl_certificate /etc/letsencrypt/live/lw-a1b2.spirde.com/fullchain.pem;');
    });

    it('forwards the real client address and rate-limits the API per client, not the websockets', () => {
      expect(script).toContain('proxy_set_header X-Forwarded-For $remote_addr;');
      expect(script).toContain('proxy_set_header X-Real-IP $remote_addr;');
      expect(script).not.toContain('$proxy_add_x_forwarded_for');
      expect(script).toContain('limit_req_zone $binary_remote_addr zone=lw_api:10m rate=20r/s;');

      const api = script.slice(script.indexOf('location /api/ {'), script.indexOf('location /socket/'));
      const sockets = script.slice(script.indexOf('location /socket/'), script.indexOf('location = /config.json'));

      expect(api).toContain('limit_req zone=lw_api burst=60 nodelay;');
      expect(sockets).not.toContain('limit_req ');
    });

    it('pins the console by the digest of the verified manifest, never by tag (M3)', () => {
      const step = script.indexOf('LW_CONSOLE_DIGEST="$(jq -r');

      expect(script).toContain(
        `'.consoleImage | select(. != null and .repository == $r) | .digest' "$LW_WORK/manifest.json"`,
      );
      expect(script).toContain('die "the release manifest pins no console image digest"');
      expect(script).toContain('LW_CONSOLE_IMAGE="ghcr.io/forepath/loadweaver-console-server@$LW_CONSOLE_DIGEST"');
      expect(script).toContain(
        `printf 'LOADWEAVER_VERSION=%s\\nLOADWEAVER_CONSOLE_IMAGE=%s\\nLOADWEAVER_CONSOLE_PIN=%s\\n' '1.4.0' "$LW_CONSOLE_IMAGE" "$LW_CONSOLE_PIN"`,
      );
      expect(script).not.toContain('loadweaver-console-server:');
      // Read only after the signature and the product / version were checked.
      expect(script.indexOf('[ -n "$LW_VERIFIED" ]')).toBeLessThan(step);
      expect(script.indexOf('.product == "loadweaver" and .version == $v')).toBeLessThan(step);
    });

    it("lets the plan's explicit console digest win over the manifest", () => {
      const digest = `sha256:${'b'.repeat(64)}`;
      const pinned = decode(
        buildLoadweaverCloudInitUserData({ ...config, console: { ...config.console, imageDigest: digest } }),
      );

      expect(pinned).toContain(`LW_CONSOLE_IMAGE='ghcr.io/forepath/loadweaver-console-server@${digest}'`);
      expect(pinned).toContain('LW_CONSOLE_PIN=plan');
      expect(pinned).not.toContain('LW_CONSOLE_DIGEST=');
      expect(() => execFileSync('bash', ['-n'], { input: pinned })).not.toThrow();
      expect(() =>
        buildLoadweaverCloudInitUserData({ ...config, console: { ...config.console, imageDigest: 'latest' } }),
      ).toThrow('sha256');
    });

    it('hardens the proxy: HSTS on TLS only, no version banner, body limits per location (L7)', () => {
      const letsEncrypt = script.slice(script.lastIndexOf('server_tokens off;'));
      const plain = letsEncrypt.slice(0, letsEncrypt.indexOf('listen 443 ssl;'));
      const tls = letsEncrypt.slice(letsEncrypt.indexOf('listen 443 ssl;'));
      const location = (path: string) =>
        tls.slice(tls.indexOf(`location ${path} {`), tls.indexOf('    }', tls.indexOf(`location ${path} {`)));

      expect(script.split('server_tokens off;')).toHaveLength(3);
      expect(plain).not.toContain('Strict-Transport-Security');
      expect(tls).toContain('add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;');
      expect(tls).not.toContain('client_max_body_size 0;\n\n    location / {');
      expect(tls).toContain(`    client_max_body_size ${LOADWEAVER_PROXY_BODY_LIMITS.api};`);
      expect(location('/')).toContain(`client_max_body_size ${LOADWEAVER_PROXY_BODY_LIMITS.console};`);
      expect(location('/api/')).not.toContain('client_max_body_size');
      expect(location('/socket/')).not.toContain('client_max_body_size');

      // Only the streamed uploads the control plane caps itself go unlimited, rate-limited like the API.
      for (const path of ['= /api/updates/bundles', '= /api/backups/imports']) {
        expect(location(path)).toContain('client_max_body_size 0;');
        expect(location(path)).toContain('proxy_request_buffering off;');
        expect(location(path)).toContain('limit_req zone=lw_api burst=60 nodelay;');
        expect(location(path)).toContain('proxy_set_header X-Forwarded-For $remote_addr;');
      }

      expect(location('/v2/')).toContain('client_max_body_size 0;');
      expect(tls.match(/client_max_body_size 0;/g)).toHaveLength(3);
    });

    it('keeps the API port off the public interfaces before the bootstrap starts it (L11)', () => {
      const firewall = buildLoadweaverCloudFirewall();

      expect(firewall).toContain('table inet loadweaver_cloud {');
      expect(firewall).toContain('type filter hook input priority filter - 10; policy accept;');
      expect(firewall).toContain('iifname "lo" accept');
      expect(firewall).toMatch(/tcp dport 3400 counter drop/);
      // Loopback and Loadweaver's own interfaces come first; the drop is the last rule.
      expect(firewall.indexOf('iifname "lo" accept')).toBeLessThan(firewall.indexOf('dport 3400'));
      expect(firewall).not.toMatch(/dport (80|443)\b/);
      expect(script).toContain(firewall.trim());
      expect(script).toContain('ExecStart=/usr/sbin/nft -f /etc/loadweaver-cloud/firewall.nft');
      expect(script).toContain('Before=network-pre.target docker.service loadweaver-agent.service');
      expect(script).toContain('systemctl enable --now loadweaver-cloud-firewall.service || die');
      expect(script).toMatch(/apt-get install [^\n]* nftables\n/);
      expect(script.indexOf('enable --now loadweaver-cloud-firewall.service')).toBeLessThan(
        script.indexOf('/usr/local/bin/loadweaver-agent bootstrap'),
      );
    });

    it('puts no cluster secrets and no floating image tags into the user-data', () => {
      expect(script).not.toMatch(/ENCRYPTION_KEY|JWT_SECRET|DB_PASSWORD|STATIC_API_KEY/);
      expect(script).not.toContain(':latest');
      expect(script).not.toContain('--pull=always');
      expect(script).toContain(SSH_KEY);
      expect(script).toContain('PasswordAuthentication no');
    });

    it('hands the admin claim token over in a root-only file, never on the command line, and removes it', () => {
      const write = `(umask 077 && printf '%s' '${CLAIM_TOKEN}' > /var/lib/loadweaver-cloud/admin-claim-token)`;

      expect(script).toContain(write);
      expect(script.split(CLAIM_TOKEN)).toHaveLength(2);
      expect(script.indexOf(write)).toBeLessThan(script.indexOf('/usr/local/bin/loadweaver-agent bootstrap'));
      expect(script.lastIndexOf('rm -f /var/lib/loadweaver-cloud/admin-claim-token')).toBeGreaterThan(
        script.indexOf('/usr/local/bin/loadweaver-agent bootstrap'),
      );
      expect(script).not.toMatch(/log [^\n]*lwc_/);
    });

    it('passes no email flags without operator SMTP (the cluster starts without email)', () => {
      expect(config.email).toBeUndefined();
      expect(script).not.toMatch(/--smtp-|--email-|smtp-password/);
    });

    it('installs the Compose plugin when Docker is preinstalled without it, before the management endpoint starts', () => {
      const check = script.indexOf('if ! docker compose version >/dev/null 2>&1; then');
      const up = script.indexOf('docker compose up -d ||');

      expect(check).toBeGreaterThan(script.indexOf('if ! command -v docker >/dev/null 2>&1; then'));
      expect(up).toBeGreaterThan(check);
      expect(script.slice(check, up)).toContain('apt-get install -y -q --no-install-recommends docker-compose-plugin');
    });

    it('uses a fresh heredoc marker per render', () => {
      const other = decode(buildLoadweaverCloudInitUserData(config));
      const marker = /<<'(LOADWEAVER_[0-9a-f]{32})'/;

      expect(script.match(marker)?.[1]).not.toEqual(other.match(marker)?.[1]);
    });
  });

  describe('operator SMTP (plan defaults smtp, like the sibling stacks)', () => {
    const PASSWORD = `p'a"ss $(rm -rf /) \`x\` \\ ;&|`;
    const smtp = {
      host: 'smtp.example.com',
      port: 465,
      user: "o'brien@example.com",
      password: PASSWORD,
      from: 'Acme Cloud <noreply@example.com>',
    };
    const render = (extra: Record<string, unknown>) =>
      decode(
        buildLoadweaverCloudInitUserData(
          buildLoadweaverCloudInitConfigFromRequest(
            { ...CLAIM, loadweaverVersion: '1.4.0', ...extra },
            'lw-a1b2',
            'spirde.com',
            {},
          ),
        ),
      );

    it('resolves the smtp block; no host means no email', () => {
      expect(resolveLoadweaverEmailSettings({ smtp })).toEqual(smtp);
      expect(resolveLoadweaverEmailSettings({ smtp: { ...smtp, port: '587' } })?.port).toBe(587);
      expect(resolveLoadweaverEmailSettings({})).toBeUndefined();
      expect(resolveLoadweaverEmailSettings({ smtp: { host: ' ', user: 'u', password: 'p' } })).toBeUndefined();
      expect(resolveLoadweaverEmailSettings({ smtp: { host: 'mail', user: '', password: '', from: '' } })).toEqual({
        host: 'mail',
      });
    });

    it('refuses SMTP settings bootstrap would reject', () => {
      expect(() => resolveLoadweaverEmailSettings({ smtp: { ...smtp, port: 70000 } })).toThrow(/port/);
      expect(() => resolveLoadweaverEmailSettings({ smtp: { ...smtp, password: '' } })).toThrow(/user and password/);
      expect(() => resolveLoadweaverEmailSettings({ smtp: { ...smtp, user: '' } })).toThrow(/user and password/);
      expect(() => resolveLoadweaverEmailSettings({ smtp: { ...smtp, from: 'a\nb' } })).toThrow(/SMTP settings/);
    });

    it('renders the bootstrap email flags, quoted, with the password only in a root-only file that is removed', () => {
      const script = render({ smtp });
      const write = `(umask 077 && printf '%s' 'p'"'"'a"ss $(rm -rf /) \`x\` \\ ;&|' > /var/lib/loadweaver-cloud/smtp-password)`;
      const bootstrap = script.indexOf('/usr/local/bin/loadweaver-agent bootstrap');

      expect(() => execFileSync('bash', ['-n'], { input: script })).not.toThrow();
      expect(script).toContain(
        `'--admin-claim-token-file' '/var/lib/loadweaver-cloud/admin-claim-token' '--smtp-host' 'smtp.example.com' '--smtp-port' '465' '--smtp-user' 'o'"'"'brien@example.com' '--smtp-password-file' '/var/lib/loadweaver-cloud/smtp-password' '--email-from' 'Acme Cloud <noreply@example.com>'`,
      );
      expect(script).toContain(write);
      expect(script.indexOf(write)).toBeLessThan(bootstrap);
      // The password appears once (the file write), never on the bootstrap command line or in the log.
      expect(script.split('$(rm -rf /)')).toHaveLength(2);
      expect(script.slice(bootstrap).split('\n')[0]).not.toContain('rm -rf');
      expect(script).toContain(
        '    rm -f /var/lib/loadweaver-cloud/admin-claim-token /var/lib/loadweaver-cloud/smtp-password\n    die "bootstrap failed"',
      );
      expect(
        script.lastIndexOf('rm -f /var/lib/loadweaver-cloud/admin-claim-token /var/lib/loadweaver-cloud/smtp-password'),
      ).toBeGreaterThan(bootstrap);
    });

    it('writes the exact password bytes and the exact flag values when run by bash', () => {
      const script = render({ smtp });
      const dir = mkdtempSync(join(tmpdir(), 'lw-smtp-'));

      try {
        const lines = script.split('\n');
        const write = lines.find((line) => line.includes('/var/lib/loadweaver-cloud/smtp-password)')) ?? '';
        const command = lines.find((line) => line.startsWith('/usr/local/bin/loadweaver-agent bootstrap')) ?? '';
        const file = join(dir, 'pw');

        execFileSync('bash', ['-c', write.replace('/var/lib/loadweaver-cloud/smtp-password', file)]);
        expect(readFileSync(file, 'utf8')).toBe(PASSWORD);

        const args = execFileSync('bash', [
          '-c',
          `printf '%s\\0' ${command.replace('/usr/local/bin/loadweaver-agent bootstrap ', '').replace(/ \|\| \{$/, '')}`,
        ])
          .toString('utf8')
          .split('\0');

        expect(args).toContain("o'brien@example.com");
        expect(args).toContain('Acme Cloud <noreply@example.com>');
        expect(args).not.toContain(PASSWORD);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('omits the password file for unauthenticated SMTP and the port when unset', () => {
      const script = render({ smtp: { host: 'relay.internal' } });

      expect(script).toContain("'--smtp-host' 'relay.internal'");
      expect(script).not.toMatch(/--smtp-port|--smtp-user|smtp-password|--email-from/);
      expect(script).toContain('rm -f /var/lib/loadweaver-cloud/admin-claim-token\n');
    });
  });

  it('points the console runtime config at the same origin', () => {
    const runtime = buildLoadweaverConsoleRuntimeConfig('lw.example.com') as {
      console: { urls: { restApi: string; websocket: Record<string, string> } };
    };

    expect(runtime.console.urls.restApi).toBe('https://lw.example.com/api');
    expect(runtime.console.urls.websocket['topology']).toBe('https://lw.example.com/socket/topology');
  });

  describe('buildLoadweaverUpdateCommand (scheduler exclusion)', () => {
    const command = buildLoadweaverUpdateCommand();

    it('never pulls or recreates the cluster', () => {
      expect(command).not.toContain('--pull');
      expect(command).not.toContain('docker compose pull');
      expect(command).not.toMatch(/docker compose up -d(?! console)/);
      expect(command).not.toContain('loadweaver-agent bootstrap');
    });

    it('only re-pins the console to the release the cluster installed, by verified digest', () => {
      expect(command).toContain('/usr/local/bin/loadweaver-agent version');
      expect(command).toContain(RELEASE_SIGNING_KEYS.loadweaver[0].trim().split('\n')[1]);
      expect(command).toContain(
        'https://github.com/forepath/one/releases/download/v$V/loadweaver-bundle-$V.manifest.json',
      );
      expect(command).not.toContain('loadweaver-console-server:');
      expect(command).toContain('docker compose up -d console');
      expect(command).toContain('exit 0');
    });

    it('refuses an unsafe release base URL', () => {
      expect(() =>
        buildLoadweaverUpdateCommand(RELEASE_SIGNING_KEYS.loadweaver, {
          LOADWEAVER_CLOUD_RELEASE_BASE_URL: 'http://x',
        }),
      ).toThrow('plain https URL');
    });
  });

  describe('buildLoadweaverUpdateCommand (console digest from the verified manifest, M3)', () => {
    const digest = `sha256:${'e'.repeat(64)}`;
    const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    // The node has jq (cloud-init installs it); this machine may not: a shim for exactly the filters the command uses.
    const JQ_SHIM = `#!/usr/bin/env node
const args = process.argv.slice(2); const vars = {}; let raw = false, exit = false; const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-r') raw = true; else if (args[i] === '-e') exit = true;
  else if (args[i] === '--arg') { vars[args[i + 1]] = args[i + 2]; i += 2; } else rest.push(args[i]);
}
const [filter, file] = rest; const doc = JSON.parse(require('fs').readFileSync(file, 'utf8'));
const filters = {
  '.signature': () => doc.signature,
  '.product == "loadweaver" and .version == $v': () => doc.product === 'loadweaver' && doc.version === vars.v,
  '.consoleImage | select(. != null and .repository == $r) | .digest': () =>
    doc.consoleImage && doc.consoleImage.repository === vars.r ? doc.consoleImage.digest : undefined,
};
if (!filters[filter]) { console.error('jq shim: unknown filter ' + filter); process.exit(3); }
const out = filters[filter]();
if (out !== undefined) console.log(raw && typeof out === 'string' ? out : JSON.stringify(out));
process.exit(exit && (out === false || out === null || out === undefined) ? 1 : 0);
`;

    function release(manifest: Record<string, unknown>, signer = keys.privateKey): Record<string, string> {
      const json = JSON.stringify(manifest);

      return {
        'loadweaver-bundle-1.5.0.manifest.json': json,
        'loadweaver-bundle-1.5.0.manifest.sig': JSON.stringify({
          signature: sign('sha256', Buffer.from(json), signer).toString('base64'),
        }),
      };
    }

    function runUpdate(
      env: string,
      files: Record<string, string>,
    ): { env: string; dockerCalled: boolean; status: number; log: string } {
      const dir = mkdtempSync(join(tmpdir(), 'lw-update-'));
      const bin = join(dir, 'bin');
      const assets = join(dir, 'assets');

      mkdirSync(bin);
      mkdirSync(assets);
      writeFileSync(join(bin, 'loadweaver-agent'), '#!/bin/sh\necho 1.5.0\n', { mode: 0o755 });
      writeFileSync(join(bin, 'docker'), `#!/bin/sh\ntouch ${dir}/docker-called\n`, { mode: 0o755 });
      writeFileSync(join(bin, 'jq'), JQ_SHIM, { mode: 0o755 });
      // curl: serves the release assets by file name from the expected base URL only.
      writeFileSync(
        join(bin, 'curl'),
        `#!/bin/sh
out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; https://*) url="$1"; shift;; *) shift;; esac; done
case "$url" in https://github.com/forepath/one/releases/download/v1.5.0/*) ;; *) exit 22;; esac
[ -f "${assets}/$(basename "$url")" ] || exit 22
cp "${assets}/$(basename "$url")" "$out"
`,
        { mode: 0o755 },
      );

      for (const [name, content] of Object.entries(files)) writeFileSync(join(assets, name), content);

      writeFileSync(join(dir, '.env'), env);

      const command = buildLoadweaverUpdateCommand([publicPem], {})
        .split('/usr/local/bin/loadweaver-agent')
        .join(join(bin, 'loadweaver-agent'))
        .split('/var/log/loadweaver-console-update.log')
        .join(join(dir, 'update.log'))
        .split('/opt/loadweaver')
        .join(dir);
      const result = spawnSync('bash', ['-c', command], {
        env: { ...process.env, PATH: `${bin}:${process.env['PATH']}` },
      });

      try {
        return {
          env: readFileSync(join(dir, '.env'), 'utf8'),
          dockerCalled: existsSync(join(dir, 'docker-called')),
          status: result.status ?? -1,
          log: existsSync(join(dir, 'update.log')) ? readFileSync(join(dir, 'update.log'), 'utf8') : '',
        };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    const manifest = {
      product: 'loadweaver',
      version: '1.5.0',
      consoleImage: { repository: 'ghcr.io/forepath/loadweaver-console-server', tag: '1.5.0', digest },
    };
    const before = `LOADWEAVER_VERSION=1.4.0\nLOADWEAVER_CONSOLE_IMAGE=ghcr.io/forepath/loadweaver-console-server@sha256:${'1'.repeat(64)}\nLOADWEAVER_CONSOLE_PIN=manifest\n`;

    it('verifies the manifest of the installed release and re-pins the console by its digest', () => {
      const result = runUpdate(before, release(manifest));

      expect(result.status).toBe(0);
      expect(result.env).toBe(
        `LOADWEAVER_VERSION=1.5.0\nLOADWEAVER_CONSOLE_IMAGE=ghcr.io/forepath/loadweaver-console-server@${digest}\nLOADWEAVER_CONSOLE_PIN=manifest\n`,
      );
      expect(result.dockerCalled).toBe(true);
    });

    it('re-pins a tag-pinned console (before M3) by verified digest too', () => {
      const result = runUpdate(
        'LOADWEAVER_VERSION=1.4.0\nLOADWEAVER_CONSOLE_IMAGE=ghcr.io/forepath/loadweaver-console-server:1.4.0\n',
        release(manifest),
      );

      expect(result.env).toContain(`LOADWEAVER_CONSOLE_IMAGE=ghcr.io/forepath/loadweaver-console-server@${digest}`);
      expect(result.dockerCalled).toBe(true);
    });

    it.each([
      ['signed by an untrusted key', () => release(manifest, other.privateKey)],
      ['for another version', () => release({ ...manifest, version: '1.4.9' })],
      ['without a console image', () => release({ product: 'loadweaver', version: '1.5.0' })],
      [
        'with a console image from another repository',
        () => release({ ...manifest, consoleImage: { ...manifest.consoleImage, repository: 'ghcr.io/evil/console' } }),
      ],
      ['missing', () => ({})],
    ])('changes nothing when the manifest is %s', (_name, files) => {
      const result = runUpdate(before, files());

      expect(result.status).toBe(1);
      expect(result.env).toBe(before);
      expect(result.dockerCalled).toBe(false);
      expect(result.log).toContain('ERROR');
    });

    it("keeps the plan's digest pin (and a digest pin from before the pin was recorded)", () => {
      const pinned = `ghcr.io/forepath/loadweaver-console-server@sha256:${'a'.repeat(64)}`;

      for (const env of [
        `LOADWEAVER_VERSION=1.4.0\nLOADWEAVER_CONSOLE_IMAGE=${pinned}\nLOADWEAVER_CONSOLE_PIN=plan\n`,
        `LOADWEAVER_VERSION=1.4.0\nLOADWEAVER_CONSOLE_IMAGE=${pinned}\n`,
      ]) {
        const result = runUpdate(env, release(manifest));

        expect(result.env).toBe(
          `LOADWEAVER_VERSION=1.5.0\nLOADWEAVER_CONSOLE_IMAGE=${pinned}\nLOADWEAVER_CONSOLE_PIN=plan\n`,
        );
        expect(result.dockerCalled).toBe(false);
      }
    });
  });

  describe('teardown guard', () => {
    const loadweaver = { configSnapshot: { service: 'loadweaver' } };
    const other = { configSnapshot: { service: 'decabill-billing' } };

    it('requires an explicit confirmation for subscriptions with a Loadweaver cluster', () => {
      expect(isLoadweaverItem(loadweaver)).toBe(true);
      expect(loadweaverTeardownConfirmationError([other, loadweaver], undefined)).toBe(
        LOADWEAVER_TEARDOWN_CONFIRMATION_REQUIRED,
      );
      expect(loadweaverTeardownConfirmationError([loadweaver], false)).toBe(LOADWEAVER_TEARDOWN_CONFIRMATION_REQUIRED);
      expect(loadweaverTeardownConfirmationError([loadweaver], true)).toBeNull();
      expect(loadweaverTeardownConfirmationError([other, { configSnapshot: null }], undefined)).toBeNull();
    });

    it('resolves the grace period', () => {
      expect(resolveLoadweaverTeardownGraceDays({})).toBe(LOADWEAVER_DEFAULT_TEARDOWN_GRACE_DAYS);
      expect(resolveLoadweaverTeardownGraceDays({ LOADWEAVER_TEARDOWN_GRACE_DAYS: '0' })).toBe(0);
      expect(resolveLoadweaverTeardownGraceDays({ LOADWEAVER_TEARDOWN_GRACE_DAYS: '14' })).toBe(14);
      expect(resolveLoadweaverTeardownGraceDays({ LOADWEAVER_TEARDOWN_GRACE_DAYS: '-1' })).toBe(
        LOADWEAVER_DEFAULT_TEARDOWN_GRACE_DAYS,
      );
      expect(resolveLoadweaverTeardownGraceDays({ LOADWEAVER_TEARDOWN_GRACE_DAYS: '1000' })).toBe(90);
      expect(loadweaverTeardownNotBefore(new Date('2026-11-01T00:00:00Z'), 7).toISOString()).toBe(
        '2026-11-08T00:00:00.000Z',
      );
    });
  });

  describe('mapLoadweaverClusterHealth', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    const base = { provisioningStatus: 'active' as const, hasProviderReference: true, now };

    it('maps provisioning states', () => {
      expect(mapLoadweaverClusterHealth({ ...base, provisioningStatus: 'pending' })).toBe('provisioning');
      expect(mapLoadweaverClusterHealth({ ...base, provisioningStatus: 'failed' })).toBe('failed');
      expect(mapLoadweaverClusterHealth({ ...base, hasProviderReference: false })).toBe('removed');
    });

    it('maps probes', () => {
      expect(mapLoadweaverClusterHealth({ ...base, api: { ok: true }, console: { ok: true } })).toBe('healthy');
      expect(mapLoadweaverClusterHealth({ ...base, api: { ok: true }, console: { ok: false } })).toBe('degraded');
      expect(
        mapLoadweaverClusterHealth({
          ...base,
          provisionedAt: new Date(now.getTime() - LOADWEAVER_STARTUP_WINDOW_MS + 60_000),
          api: { ok: false },
        }),
      ).toBe('starting');
      expect(
        mapLoadweaverClusterHealth({
          ...base,
          provisionedAt: new Date(now.getTime() - LOADWEAVER_STARTUP_WINDOW_MS - 60_000),
          api: { ok: false, status: 502 },
        }),
      ).toBe('unreachable');
    });
  });
});
