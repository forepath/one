import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  buildManifest,
  canonicalJson,
  generateReleaseKeyPair,
  signManifest,
  type ReleaseManifest,
} from '@forepath/loadweaver/shared/util-release';

import { startVmLab, type Vm, type VmLab } from './vm-lab';

/**
 * Loadweaver Cloud (Decabill service kind `loadweaver`, P3) on a real Debian 13 VM: the user-data Decabill renders
 * (`buildLoadweaverCloudInitUserData`, bundled at test time from the Decabill contributor so this project doesn't
 * import another domain) runs once like cloud-init would and must leave a working single-node cluster behind its TLS
 * proxy:
 *
 * - release trust: the manifest + signature come from an HTTPS release server on the VM (lab CA), signed with a
 *   dev release key passed as the trusted key; a manifest signed by another key and an agent binary that doesn't match
 *   the manifest's SHA-256 both stop the script before anything is installed;
 * - `loadweaver-agent bootstrap --public-url` (+ `LOADWEAVER_TRUST_PROXY=loopback`, the admin-claim hash), the node
 *   components from the local control plane (`/api/install/components.sh`) and the agent unit;
 * - the management endpoint: console digest-pinned from the verified manifest (`consoleImage`, built with
 *   `--console-image` semantics), nginx with `limit_req`, `/api`, `/v2`, `/config.json`;
 * - the admin claim through nginx: registration without / with a wrong token → 403, with the token → admin, every
 *   further registration closed (503);
 * - the `inet loadweaver_cloud` nftables table: `<VM IP>:3400` is not reachable from outside (the lab switch), 443 is.
 *
 * Lab deviations (documented in the README): Certbot is stubbed — the lab has no public DNS, so the stub issues a
 * certificate from the lab CA where Let's Encrypt would and the script's own switch to the Let's Encrypt nginx config
 * runs; the control-plane image is this tree's (`LOADWEAVER_CONTROL_PLANE_IMAGE`, the agent's development override, for the
 * bootstrap and — through a systemd drop-in — the installed agent)
 * and the console image is loaded into the VM instead of pulled from ghcr.io (same digest reference).
 *
 * Needs: `loadweaver-control-plane-api:dr-lab` (see dr.vm-lab.spec.ts), `ghcr.io/forepath/loadweaver-console-server:latest`
 * (`npx nx run loadweaver-frontend-console:server-container-image`) and the SEA agent
 * (`npx nx run loadweaver-backend-node-agent:sea`).
 */

const WORKSPACE = resolve(__dirname, '../../../../../../../..');
const DECABILL_UTILS = join(
  WORKSPACE,
  'libs/domains/decabill/backend/feature-billing-manager/src/lib/contributors/loadweaver/loadweaver.utils.ts',
);
const AGENT_SEA = join(WORKSPACE, 'dist/apps/loadweaver/backend-node-agent/sea/loadweaver-agent');
const CP_IMAGE = 'loadweaver-control-plane-api:dr-lab';
const CONSOLE_IMAGE = 'ghcr.io/forepath/loadweaver-console-server:latest';
const CONSOLE_REPOSITORY = 'ghcr.io/forepath/loadweaver-console-server';
const VERSION = '0.0.0-cloudlab.1';
const HOSTNAME = 'cloud';
const BASE_DOMAIN = 'lab.test';
const FQDN = `${HOSTNAME}.${BASE_DOMAIN}`;
const RELEASE_HOST = 'releases.lab.test';
const RELEASE_BASE = `https://${RELEASE_HOST}:8443/lw`;
const RELEASE_ROOT = '/srv/lw-release';
const LAB_CA = '/etc/lw-lab/ca.crt';
const KEY = generateReleaseKeyPair();
const FOREIGN_KEY = generateReleaseKeyPair();
const CLAIM_TOKEN = `lwc_${'a1B2c3D4e5'.repeat(4)}xyz`;
const PASSWORD = 'Cloud-lab-Passw0rd!';

/** Section of the rendered script the stub replaces (pip install of Certbot, public IP / DNS wait). */
const CERTBOT_INSTALL_START = '# Install dependencies for Certbot';
const CERTBOT_REQUEST = `log "Requesting Let's Encrypt certificate via Certbot webroot..."`;

interface LoadweaverUtils {
  buildLoadweaverCloudInitConfigFromRequest(
    effectiveConfig: Record<string, unknown>,
    hostname: string,
    baseDomain?: string,
    env?: NodeJS.ProcessEnv,
  ): {
    release: { trustedKeys: readonly string[] };
    [key: string]: unknown;
  };
  buildLoadweaverCloudInitUserData(config: unknown): string;
}

/** Small HTTPS file server for the release assets (the VM can't reach the test process). */
const RELEASE_SERVER = `const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const root = ${JSON.stringify(RELEASE_ROOT)};
https
  .createServer({ key: fs.readFileSync('/etc/lw-lab/release.key'), cert: fs.readFileSync('/etc/lw-lab/release.crt') }, (req, res) => {
    const file = path.join(root, path.normalize(decodeURIComponent((req.url || '/').split('?')[0])));
    if (!file.startsWith(root + '/') || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader('content-length', fs.statSync(file).size);
    fs.createReadStream(file).pipe(res);
  })
  .listen(8443, '127.0.0.1');
`;

/** Where Let's Encrypt would issue: a certificate from the lab CA, so console / docker clients can trust it. */
const CERTBOT_STUB = `log "VM lab: Certbot stubbed (no public DNS in the lab); the lab CA issues the certificate instead"
FQDN="${FQDN}"
certbot() {
    mkdir -p "/etc/letsencrypt/live/$FQDN"
    openssl req -new -nodes -newkey rsa:2048 -keyout "/etc/letsencrypt/live/$FQDN/privkey.pem" \\
        -subj "/CN=$FQDN" -out /tmp/lw-lab-le.csr 2>/dev/null
    openssl x509 -req -in /tmp/lw-lab-le.csr -CA /etc/lw-lab/ca.crt -CAkey /etc/lw-lab/ca.key -CAcreateserial \\
        -days 30 -extfile <(printf 'subjectAltName=DNS:%s\\nextendedKeyUsage=serverAuth\\n' "$FQDN") \\
        -out "/etc/letsencrypt/live/$FQDN/fullchain.pem" 2>/dev/null
    rm -f /tmp/lw-lab-le.csr
}
`;

describe('Loadweaver Cloud user-data (VM lab)', () => {
  let lab: VmLab;
  let vm1: Vm;
  let local = '';
  let utils: LoadweaverUtils;
  let agentSha = '';
  let agentSize = 0;
  let consoleDigest = '';
  const facts: Record<string, unknown> = {};

  /** curl from outside the guest: the lab switch's network namespace (where the VM containers live). */
  const outside = (args: string[], allowFailure = false): { code: number; out: string } => {
    try {
      return {
        code: 0,
        out: execFileSync('docker', ['exec', vm1.container, ...args], { encoding: 'utf8', timeout: 120_000 }),
      };
    } catch (error) {
      if (!allowFailure) throw error;

      const e = error as { status?: number; stdout?: string };

      return { code: e.status ?? -1, out: e.stdout ?? '' };
    }
  };
  /** HTTPS through nginx on the VM's public address (lab CA trusted, name resolved to the VM). */
  const viaProxy = (method: string, path: string, body?: unknown): { status: number; body: string } => {
    const { out } = outside([
      'curl',
      '-sS',
      '--max-time',
      '30',
      '--cacert',
      '/tmp/lw-lab-ca.crt',
      '--resolve',
      `${FQDN}:443:${vm1.ip}`,
      '-X',
      method,
      ...(body === undefined ? [] : ['-H', 'content-type: application/json', '--data', JSON.stringify(body)]),
      '-w',
      '\n%{http_code}',
      `https://${FQDN}${path}`,
    ]);
    const lines = out.split('\n');

    return { status: Number(lines.pop()), body: lines.join('\n') };
  };

  const publishRelease = async (options: { signWith?: string; tamperAgent?: boolean } = {}) => {
    const agentPath = `artifacts/agent/loadweaver-agent-${VERSION}-linux-amd64`;
    const manifest: ReleaseManifest = buildManifest({
      version: VERSION,
      channel: 'stable',
      created: new Date().toISOString(),
      images: { 'control-plane': `ghcr.io/forepath/loadweaver-control-plane-api:${VERSION}@sha256:${'c'.repeat(64)}` },
      consoleImage: `${CONSOLE_REPOSITORY}:${VERSION}@${consoleDigest}`,
      agentBinaries: { amd64: { path: agentPath, sha256: agentSha, size: agentSize } },
    });
    const bytes = canonicalJson(manifest);
    const signature = signManifest(Buffer.from(bytes), options.signWith ?? KEY.privateKeyPem);

    writeFileSync(join(local, 'manifest.json'), bytes);
    writeFileSync(join(local, 'manifest.sig'), JSON.stringify(signature));

    const dir = `${RELEASE_ROOT}/lw/v${VERSION}`;

    await vm1.exec(`install -d -m 0755 ${dir}`);
    await vm1.copyIn(join(local, 'manifest.json'), `${dir}/loadweaver-bundle-${VERSION}.manifest.json`);
    await vm1.copyIn(join(local, 'manifest.sig'), `${dir}/loadweaver-bundle-${VERSION}.manifest.sig`);
    await vm1.exec(
      `cp /var/tmp/loadweaver-agent ${dir}/loadweaver-agent-${VERSION}-linux-amd64` +
        (options.tamperAgent ? ` && printf x >> ${dir}/loadweaver-agent-${VERSION}-linux-amd64` : ''),
    );

    return manifest;
  };

  const userData = (): string => {
    const config = utils.buildLoadweaverCloudInitConfigFromRequest(
      {
        loadweaverVersion: VERSION,
        clusterName: 'Cloud lab',
        defaultLocale: 'en',
        sshPublicKey: readFileSync(join(local, 'id_lab.pub'), 'utf8').trim(),
        loadweaverAdminClaimToken: CLAIM_TOKEN,
      },
      HOSTNAME,
      BASE_DOMAIN,
      { LOADWEAVER_CLOUD_RELEASE_BASE_URL: RELEASE_BASE, LETS_ENCRYPT_EMAIL: 'ops@lab.test' },
    );
    // Dev-signed lab releases: the lab key is the trusted release key (production: the compiled-in keys).
    const script = Buffer.from(
      utils.buildLoadweaverCloudInitUserData({
        ...config,
        release: { ...config.release, trustedKeys: [KEY.publicKeyPem] },
      }),
      'base64',
    ).toString('utf8');
    const start = script.indexOf(CERTBOT_INSTALL_START);
    const request = script.indexOf(CERTBOT_REQUEST);

    // Fails loudly when the Certbot part changes shape (the stub must replace exactly the install / DNS wait).
    expect(start).toBeGreaterThan(0);
    expect(request).toBeGreaterThan(start);

    return script.slice(0, start) + CERTBOT_STUB + script.slice(request);
  };

  /** Runs the user-data as cloud-init would (root, detached from the ssh session) and waits for it. */
  let runs = 0;
  const runUserData = async (timeoutMs: number) => {
    const unit = `lw-userdata-${++runs}`;

    writeFileSync(join(local, 'user-data.sh'), userData());
    await vm1.copyIn(join(local, 'user-data.sh'), '/root/user-data.sh', '0700');
    await vm1.exec(
      `systemd-run --unit ${unit} --property=RemainAfterExit=yes --setenv=LOADWEAVER_CONTROL_PLANE_IMAGE=${CP_IMAGE} ` +
        `--property=StandardOutput=append:/var/log/${unit}.log --property=StandardError=append:/var/log/${unit}.log /bin/bash /root/user-data.sh`,
    );

    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const state = (
        await vm1.exec(`systemctl show -p SubState -p ExecMainStatus ${unit} | sort | tr '\\n' ' '`)
      ).trim();
      const status = /ExecMainStatus=(\d+)/.exec(state)?.[1];

      if (/SubState=(exited|failed)/.test(state)) {
        const log = await vm1.exec(`tail -n 60 /var/log/${unit}.log`, { allowFailure: true });

        return { code: Number(status), log };
      }

      if (Date.now() > deadline) {
        const log = await vm1.exec(`tail -n 120 /var/log/${unit}.log`, { allowFailure: true });

        throw new Error(`user-data did not finish in time:\n${log}`);
      }

      await new Promise((r) => setTimeout(r, 10_000));
    }
  };

  beforeAll(async () => {
    local = mkdtempSync(join(tmpdir(), 'lw-vmlab-cloud-'));

    for (const image of [CP_IMAGE, CONSOLE_IMAGE])
      execFileSync('docker', ['image', 'inspect', image], { stdio: 'ignore' });

    if (!existsSync(AGENT_SEA)) throw new Error(`the lab needs the SEA agent ${AGENT_SEA} (nx run …:sea)`);

    const agent = readFileSync(AGENT_SEA);

    agentSha = createHash('sha256').update(agent).digest('hex');
    agentSize = agent.length;

    // The Decabill renderer, bundled (esbuild) instead of imported: cross-domain imports are not allowed here.
    writeFileSync(join(local, 'entry.ts'), `export * from ${JSON.stringify(DECABILL_UTILS.replace(/\.ts$/, ''))};\n`);
    execFileSync(
      join(WORKSPACE, 'node_modules/.bin/esbuild'),
      [
        join(local, 'entry.ts'),
        '--bundle',
        '--platform=node',
        '--format=cjs',
        '--target=node24',
        `--tsconfig=${join(WORKSPACE, 'tsconfig.base.json')}`,
        `--outfile=${join(local, 'loadweaver-utils.cjs')}`,
        '--log-level=error',
      ],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- bundled at test time (see above)
    utils = require(join(local, 'loadweaver-utils.cjs')) as LoadweaverUtils;
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'decabill-lab', '-f', join(local, 'id_lab')]);
    execFileSync('docker', ['save', '-o', join(local, 'cp.tar'), CP_IMAGE]);
    execFileSync('docker', ['save', '-o', join(local, 'console.tar'), CONSOLE_IMAGE]);

    lab = await startVmLab({
      vms: [{ name: 'vm1', site: 'a', memoryMb: 4096, cpus: 3, rootDiskGb: 20 }],
      log: (line) => process.stderr.write(`[vm-lab] ${line}\n`),
    });
    ({ vm1 } = lab.vms as Record<'vm1', Vm>);

    // Lab CA, the release server's certificate, name resolution for the release host and the cluster name.
    await vm1.exec(
      [
        'install -d -m 0700 /etc/lw-lab',
        'cd /etc/lw-lab',
        `openssl req -x509 -nodes -newkey ec -pkeyopt ec_paramgen_curve:P-256 -days 30 -subj '/CN=Loadweaver VM lab CA' -keyout ca.key -out ca.crt 2>/dev/null`,
        `openssl req -new -nodes -newkey ec -pkeyopt ec_paramgen_curve:P-256 -subj '/CN=${RELEASE_HOST}' -keyout release.key -out release.csr 2>/dev/null`,
        `openssl x509 -req -in release.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 30 -extfile <(printf 'subjectAltName=DNS:${RELEASE_HOST}\\n') -out release.crt 2>/dev/null`,
        'install -m 0644 ca.crt /usr/local/share/ca-certificates/lw-vm-lab.crt',
        'update-ca-certificates >/dev/null',
        `printf '127.0.0.1 ${RELEASE_HOST}\\n${vm1.ip} ${FQDN}\\n' >> /etc/hosts`,
        `install -d -m 0755 ${RELEASE_ROOT} /opt/lw-lab`,
        // This tree's control-plane image for the installed agent too (the user-data passes it to the bootstrap).
        'install -d /etc/systemd/system/loadweaver-agent.service.d',
        `printf '[Service]\\nEnvironment=LOADWEAVER_CONTROL_PLANE_IMAGE=${CP_IMAGE}\\n' > /etc/systemd/system/loadweaver-agent.service.d/lab.conf`,
      ].join('\n'),
    );
    writeFileSync(join(local, 'release-server.js'), RELEASE_SERVER);
    await vm1.copyIn(join(local, 'release-server.js'), '/opt/lw-lab/release-server.js');
    await vm1.exec('systemd-run --unit lw-release-server node /opt/lw-lab/release-server.js');
    await vm1.copyOut(LAB_CA, join(local, 'lab-ca.crt'));
    execFileSync('docker', ['cp', join(local, 'lab-ca.crt'), `${vm1.container}:/tmp/lw-lab-ca.crt`]);

    // Images: this tree's control plane and console, loaded instead of pulled (the console keeps its digest).
    await vm1.copyIn(AGENT_SEA, '/var/tmp/loadweaver-agent', '0755');

    for (const tar of ['cp.tar', 'console.tar']) {
      await vm1.copyIn(join(local, tar), `/var/tmp/${tar}`);
      await vm1.exec(`docker load -q -i /var/tmp/${tar} >/dev/null && rm -f /var/tmp/${tar}`, { timeoutMs: 900_000 });
    }

    consoleDigest = (await vm1.exec(`docker image inspect -f '{{.Id}}' ${CONSOLE_IMAGE}`)).trim();
    expect(consoleDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    // The digest reference the compose file will use must resolve to the loaded image (no pull from ghcr.io).
    await vm1.exec(`docker image inspect ${CONSOLE_REPOSITORY}@${consoleDigest} >/dev/null`);
  }, 2_400_000);

  afterAll(async () => {
    process.stderr.write(`[cloud] facts ${JSON.stringify(facts)}\n`);

    // Debugging: LW_VMLAB_KEEP=1 leaves the lab running (remove it with the vm-lab-cleanup target).
    if (process.env['LW_VMLAB_KEEP'] === '1' && lab) {
      process.stderr.write(`[cloud] lab kept: ${lab.run} (vm1 ${vm1?.container}, ${vm1?.ip})\n`);
      if (local) rmSync(local, { recursive: true, force: true });

      return;
    }

    await lab?.stop();
    if (local) rmSync(local, { recursive: true, force: true });
  }, 300_000);

  it('refuses a release manifest signed by an untrusted key before installing anything', async () => {
    await publishRelease({ signWith: FOREIGN_KEY.privateKeyPem });

    const result = await runUserData(900_000);

    expect(result.code).not.toBe(0);
    expect(result.log).toContain('the release manifest is not signed by a trusted Loadweaver release key');
    expect(await vm1.exec('test -e /usr/local/bin/loadweaver-agent && echo yes || echo no')).toBe('no\n');
  });

  it('refuses an agent binary that does not match the signed manifest', async () => {
    await publishRelease({ tamperAgent: true });

    const result = await runUserData(900_000);

    expect(result.code).not.toBe(0);
    expect(result.log).toContain('agent checksum mismatch');
    expect(await vm1.exec('test -e /usr/local/bin/loadweaver-agent && echo yes || echo no')).toBe('no\n');
  });

  it('provisions the cluster from the verified release', async () => {
    await publishRelease();

    const start = Date.now();
    const result = await runUserData(2_400_000);

    facts['provisionSeconds'] = Math.round((Date.now() - start) / 1000);
    expect({ code: result.code, log: result.code === 0 ? '' : result.log }).toEqual({ code: 0, log: '' });

    const log = await vm1.exec('cat /var/log/loadweaver-provisioning.log');

    expect(log).toContain(`Console image from the verified manifest: ${CONSOLE_REPOSITORY}@${consoleDigest}`);
    expect(log).toContain('VM lab: Certbot stubbed');
    expect(log).toContain(`Let's Encrypt certificate obtained successfully for ${FQDN}`);
    expect((await vm1.exec('sha256sum /usr/local/bin/loadweaver-agent')).split(' ')[0]).toBe(agentSha);
    // The claim token never stays on the node; the control plane got only its hash, the public URL and the proxy trust.
    expect(await vm1.exec('test -e /var/lib/loadweaver-cloud/admin-claim-token && echo yes || echo no')).toBe('no\n');

    const env = JSON.parse(await vm1.exec(`docker inspect -f '{{json .Config.Env}}' lw-control-plane`)) as string[];

    expect(env).toEqual(
      expect.arrayContaining([
        `LOADWEAVER_PUBLIC_URL=https://${FQDN}`,
        'LOADWEAVER_TRUST_PROXY=loopback',
        `ADMIN_CLAIM_TOKEN_SHA256=${createHash('sha256').update(CLAIM_TOKEN).digest('hex')}`,
      ]),
    );
    expect(env.some((e) => e.includes(CLAIM_TOKEN))).toBe(false);
    expect(await vm1.exec(`grep -c '${CLAIM_TOKEN}' /var/log/loadweaver-provisioning.log || true`)).toBe('0\n');
    expect((await vm1.exec('systemctl is-active loadweaver-agent')).trim()).toBe('active');
    expect(await vm1.exec('cat /opt/loadweaver/.env')).toContain(
      `LOADWEAVER_CONSOLE_IMAGE=${CONSOLE_REPOSITORY}@${consoleDigest}\nLOADWEAVER_CONSOLE_PIN=manifest`,
    );
    expect(await vm1.exec('grep -c letsencrypt/live /opt/loadweaver/sites-enabled/default.conf')).not.toBe('0\n');
    expect(await vm1.exec('grep -c "certbot renew" /etc/crontab')).toBe('1\n');
  });

  it('keeps the API port off the public interface (nftables) and serves through nginx', async () => {
    const table = await vm1.exec('nft list table inet loadweaver_cloud');

    expect(table).toContain('tcp dport 3400 counter');
    expect(table).toContain('drop');
    // Loopback (nginx → API) still works inside the node.
    expect(await vm1.exec('curl -fsS http://127.0.0.1:3400/api/health')).toContain('"ok"');

    const direct = outside(['curl', '-sS', '--max-time', '8', `http://${vm1.ip}:3400/api/health`], true);

    expect(direct.code).not.toBe(0);
    facts['direct3400'] = direct.code;

    const health = viaProxy('GET', '/api/health');

    expect(health.status).toBe(200);
    expect(health.body).toContain('ok');

    // The console server redirects `/` to the locale (`/en/`); it warms its file cache before it listens (502 until).
    const consoleStart = Date.now();
    let consolePage = viaProxy('GET', '/en/');

    while (consolePage.status !== 200 && Date.now() - consoleStart < 180_000) {
      await new Promise((r) => setTimeout(r, 5_000));
      consolePage = viaProxy('GET', '/en/');
    }

    facts['consoleReadyAfterSeconds'] = Math.round((Date.now() - consoleStart) / 1000);

    expect(consolePage.status).toBe(200);
    expect(consolePage.body).toMatch(/<html/i);

    const config = viaProxy('GET', '/config.json');

    expect(config.status).toBe(200);
    expect(JSON.parse(config.body)).toMatchObject({ console: { urls: { restApi: `https://${FQDN}/api` } } });

    // Registry through /v2 (token realm on the public URL). The agent starts Garage + the registry after the bootstrap
    // (images pulled through the lab NAT), so the proxy answers 503 until then.
    const v2Head = () =>
      outside(
        [
          'curl',
          '-sS',
          '-o',
          '/dev/null',
          '-D',
          '-',
          '--cacert',
          '/tmp/lw-lab-ca.crt',
          '--resolve',
          `${FQDN}:443:${vm1.ip}`,
          `https://${FQDN}/v2/`,
        ],
        true,
      ).out;
    const registryStart = Date.now();
    let v2 = v2Head();

    while (!/^HTTP\/\S+ 401/.test(v2) && Date.now() - registryStart < 900_000) {
      await new Promise((r) => setTimeout(r, 10_000));
      v2 = v2Head();
    }

    facts['registryReadyAfterSeconds'] = Math.round((Date.now() - registryStart) / 1000);

    if (!/^HTTP\/\S+ 401/.test(v2))
      facts['containers'] = await vm1.exec("docker ps -a --format '{{.Names}} {{.Status}}'", { allowFailure: true });

    facts['v2'] = v2.split('\n')[0];
    expect(v2).toMatch(/^HTTP\/\S+ 401/);
    expect(v2.toLowerCase()).toContain(`realm="https://${FQDN}/api/registry/token"`);

    const headers = outside(
      [
        'curl',
        '-sS',
        '-o',
        '/dev/null',
        '-D',
        '-',
        '--cacert',
        '/tmp/lw-lab-ca.crt',
        '--resolve',
        `${FQDN}:443:${vm1.ip}`,
        `https://${FQDN}/`,
      ],
      true,
    ).out.toLowerCase();

    expect(headers).toContain('strict-transport-security: max-age=31536000; includesubdomains');
    expect(headers).not.toMatch(/^server: nginx\/\d/m);
  });

  it('claims the cluster once with the admin claim token, then closes signup', async () => {
    expect(JSON.parse(viaProxy('GET', '/api/install/claim-status').body)).toEqual({
      claimRequired: true,
      claimConfigured: true,
    });
    expect(viaProxy('POST', '/api/auth/register', { email: 'admin@lab.test', password: PASSWORD }).status).toBe(403);
    expect(
      viaProxy('POST', '/api/auth/register', {
        email: 'admin@lab.test',
        password: PASSWORD,
        adminClaimToken: `lwc_${'z'.repeat(43)}`,
      }).status,
    ).toBe(403);

    const claimed = viaProxy('POST', '/api/auth/register', {
      email: 'admin@lab.test',
      password: PASSWORD,
      adminClaimToken: CLAIM_TOKEN,
    });

    expect(claimed.status).toBe(201);
    expect(JSON.parse(claimed.body)).toMatchObject({ user: { email: 'admin@lab.test', role: 'admin' } });
    expect(JSON.parse(viaProxy('GET', '/api/install/claim-status').body)).toEqual({
      claimRequired: false,
      claimConfigured: true,
    });
    expect(
      viaProxy('POST', '/api/auth/register', {
        email: 'second@lab.test',
        password: PASSWORD,
        adminClaimToken: CLAIM_TOKEN,
      }).status,
    ).toBe(503);
  });

  it('logs in to the registry through nginx /v2', async () => {
    const login = await vm1.execResult(
      [
        `install -d /etc/docker/certs.d/${FQDN}`,
        `cp ${LAB_CA} /etc/docker/certs.d/${FQDN}/ca.crt`,
        `printf '%s' '${PASSWORD}' | docker login ${FQDN} -u admin@lab.test --password-stdin`,
      ].join('\n'),
      { timeoutMs: 120_000, allowFailure: true },
    );

    facts['dockerLogin'] = `${login.code}: ${(login.stdout + login.stderr).trim().slice(0, 300)}`;
    expect(login.code).toBe(0);
  });

  it('rate-limits a single client on /api (nginx limit_req)', async () => {
    const statuses = outside([
      'bash',
      '-c',
      `for i in $(seq 1 150); do curl -s -o /dev/null -w '%{http_code}\\n' --cacert /tmp/lw-lab-ca.crt --resolve ${FQDN}:443:${vm1.ip} https://${FQDN}/api/health & done; wait`,
    ])
      .out.trim()
      .split('\n');
    const count = (code: string) => statuses.filter((s) => s === code).length;

    facts['limitReq'] = { ok: count('200'), limited: count('429') };
    expect(count('429')).toBeGreaterThan(0);
    expect(count('200')).toBeGreaterThanOrEqual(60);
  });
});
