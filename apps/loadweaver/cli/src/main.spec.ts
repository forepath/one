import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main, VERSION } from './main';

/** An app-signed PAT as the identity backend issues it (`amr: ['pat']`); the signature isn't checked here. */
const PAT = `e30.${Buffer.from(JSON.stringify({ sub: 'u1', amr: ['pat'] })).toString('base64url')}.sig`;

describe('loadweaver CLI', () => {
  let dir: string;
  let server: Server;
  let url: string;
  const requests: { method: string; path: string; auth?: string; body: string }[] = [];
  const env = { ...process.env };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-cli-'));
    process.env['XDG_CONFIG_HOME'] = dir;
    delete process.env['LOADWEAVER_URL'];
    delete process.env['LOADWEAVER_TOKEN'];
    // The control plane's API, as far as the CLI uses it here.
    server = createServer((req, res) => {
      let body = '';

      req.on('data', (c) => (body += c));
      req.on('end', () => {
        requests.push({ method: req.method ?? '', path: req.url ?? '', auth: req.headers.authorization, body });
        res.setHeader('content-type', 'application/json');

        if (req.headers.authorization !== `Bearer ${PAT}`) {
          res.statusCode = 401;
          res.end(JSON.stringify({ message: 'Unauthorized' }));
        } else if (req.url === '/api/overview') res.end(JSON.stringify({ nodes: [] }));
        else if (req.url === '/api/access/me')
          res.end(JSON.stringify({ userId: 'u-1', clusterRole: null, projects: { shop: 'admin' } }));
        else if (req.url === '/api/plans' && req.method === 'POST')
          res.end(
            JSON.stringify({
              id: 'abcdef12-0000',
              status: 'pending',
              changes: [
                { action: 'create', kind: 'Project', name: 'shop' },
                { action: 'unchanged', kind: 'Cluster', name: 'cluster' },
              ],
            }),
          );
        else if (req.url === '/api/plans/abcdef12-0000/apply')
          res.end(
            JSON.stringify({ id: 'abcdef12-0000', status: 'applied', progress: { step: 'Applied', percent: 100 } }),
          );
        else {
          res.statusCode = 404;
          res.end('{}');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.close();
    process.env = env;
    await rm(dir, { recursive: true, force: true });
  });

  it('logs in with a PAT (checked, stored privately), plans and applies', async () => {
    const out: string[] = [];

    await expect(main(['login', '--url', url, '--token', 'wrong'], (l) => out.push(l))).rejects.toThrow('HTTP 401');
    await main(['login', '--url', url, '--token', PAT], (l) => out.push(l));

    const configFile = join(dir, 'loadweaver', 'cli.json');

    expect(JSON.parse(await readFile(configFile, 'utf8'))).toEqual({ url, token: PAT });
    // Validated with the overview, which any authenticated user may read (not only cluster roles).
    expect(requests.filter((r) => r.auth === `Bearer ${PAT}`).map((r) => r.path)).toEqual(['/api/overview']);
    expect((await stat(configFile)).mode & 0o777).toBe(0o600);

    await main(['whoami'], (l) => out.push(l));

    const file = join(dir, 'shop.yaml');

    await writeFile(file, 'apiVersion: loadweaver.com/v1\nkind: Project\nmetadata: { name: shop }\nspec: {}\n');
    await main(['plan', '-f', file, '--apply'], (l) => out.push(l));

    expect(out).toEqual([
      `Logged in to ${url}`,
      `${url}: u-1`,
      'cluster role: none',
      'projects: shop (admin)',
      'Plan abcdef12-0000',
      '  create  Project shop',
      'abcdef12  applied         100 %  Applied',
    ]);
    expect(JSON.parse(requests.find((r) => r.path === '/api/plans')?.body ?? '{}').documents).toContain(
      'kind: Project',
    );
  });

  it('refuses socket commands with a personal access token before doing anything', async () => {
    const before = requests.length;

    await expect(main(['watch', 'abcdef12-0000'])).rejects.toThrow(
      'watch needs an interactive login: loadweaver login --email',
    );
    await expect(main(['port-forward', 'shop/site/db', '5432'])).rejects.toThrow(
      'port-forward needs an interactive login',
    );
    await expect(main(['apply', 'abcdef12-0000', '--watch'])).rejects.toThrow('--watch needs an interactive login');
    await expect(main(['plan', '-f', join(dir, 'shop.yaml'), '--apply', '--watch'])).rejects.toThrow(
      '--watch needs an interactive login',
    );
    expect(requests.length).toBe(before);
  });

  it('prints the baked-in version (0.0.0-dev outside a webpack build) and the control plane it talks to', async () => {
    const out: string[] = [];

    await main(['version'], (l) => out.push(l));
    expect(out[0]).toBe(`loadweaver CLI ${VERSION}`);
    expect(out[1]).toMatch(/^control plane (unknown|unreachable|\S+) \(/);
    expect(VERSION).toBe('0.0.0-dev');
  });

  it('explains what is missing', async () => {
    await expect(main(['apply'])).rejects.toThrow('apply <plan id>');
    await expect(main(['port-forward', 'db'])).rejects.toThrow('port-forward');

    process.env['XDG_CONFIG_HOME'] = join(dir, 'empty');
    await expect(main(['whoami'])).rejects.toThrow('not logged in');
  });
});
