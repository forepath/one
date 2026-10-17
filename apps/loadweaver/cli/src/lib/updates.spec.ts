import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { updates, version } from './commands';
import { checkClusterVersion, resetVersionWarning } from './version';

const ROLLOUT = {
  id: 'r1',
  status: 'planned',
  kind: 'minor',
  fromVersion: '3.4.0',
  toVersion: '3.5.0',
  pauseReason: null,
  warnings: ['old predates release components'],
  notes: ['read me'],
  diff: [{ node: 'n1', component: 'node-agent', from: '3.4.0', to: '3.5.0', method: 'binary swap' }],
  progress: { done: 0, total: 1, currentWave: 0 },
  steps: [{ index: 0, wave: 0, phase: 'canary', node: 'n1', state: 'pending', error: null }],
};

describe('CLI updates (3.26)', () => {
  let server: Server;
  const requests: { method: string; path: string; type?: string; body: Buffer }[] = [];
  const env = { ...process.env };
  let watchCalls = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];

      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        requests.push({
          method: req.method ?? '',
          path: req.url ?? '',
          type: req.headers['content-type'],
          body: Buffer.concat(chunks),
        });
        res.setHeader('x-loadweaver-version', '3.5.0');
        res.setHeader('content-type', 'application/json');

        if (req.url === '/api/updates/status')
          return res.end(
            JSON.stringify({
              clusterVersion: '3.5.0',
              controlPlaneVersion: '3.5.0',
              latestAvailable: '3.5.1',
              activeRollout: null,
              policy: { policy: 'auto-patch', channel: 'stable', source: 'github' },
              nodes: [{ name: 'n1', agentVersion: '3.5.0', release: '3.5.0', target: '3.5.1', rebootRequired: true }],
            }),
          );

        if (req.url === '/api/updates/releases')
          return res.end(
            JSON.stringify([{ version: '3.5.1', channel: 'stable', status: 'available', signed: false, error: null }]),
          );

        if (req.url === '/api/updates/bundles')
          return res.end(JSON.stringify({ version: '3.5.1', status: 'available', signed: true }));

        if (req.url === '/api/updates/rollouts' && req.method === 'POST') return res.end(JSON.stringify(ROLLOUT));

        if (req.url === '/api/updates/rollouts/r1' && req.method === 'GET')
          return res.end(JSON.stringify({ ...ROLLOUT, status: ++watchCalls > 1 ? 'completed' : 'running' }));

        if (req.url?.startsWith('/api/updates/rollouts/r1/'))
          return res.end(JSON.stringify({ ...ROLLOUT, status: 'approved' }));

        if (req.url === '/api/install/loadweaver-agent.service') return res.end('[Unit]');

        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    process.env['XDG_CONFIG_HOME'] = await mkdtemp(join(tmpdir(), 'lw-cli-updates-'));
    process.env['LOADWEAVER_URL'] = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env['LOADWEAVER_TOKEN'] = 'token';
  });

  afterAll(() => {
    process.env = env;
    server.close();
  });

  it('shows status and releases', async () => {
    const out: string[] = [];

    await updates({ action: 'status' }, (l) => out.push(l));
    await updates({ action: 'releases' }, (l) => out.push(l));
    expect(out).toEqual([
      'cluster 3.5.0 (control plane 3.5.0), policy auto-patch, channel stable, source github',
      'available: 3.5.1',
      '  n1               agent 3.5.0 release 3.5.0 → 3.5.1 (reboot pending)',
      '3.5.1              stable available (unsigned)',
    ]);
  });

  it('plans, approves (emergency), watches and uploads bundles as a stream', async () => {
    const out: string[] = [];

    await updates({ action: 'plan', target: '3.5.0', host: true }, (l) => out.push(l));
    expect(JSON.parse(requests.at(-1)?.body.toString() ?? '{}')).toEqual({ version: '3.5.0', host: true });
    expect(out).toContain('  warning: old predates release components');
    expect(out).toContain('  wave  0 canary        n1               pending');

    await updates({ action: 'approve', target: 'r1', emergency: true }, () => undefined);
    expect(requests.at(-1)).toMatchObject({ method: 'POST', path: '/api/updates/rollouts/r1/approve' });
    expect(JSON.parse(requests.at(-1)?.body.toString() ?? '{}')).toEqual({ emergency: true });

    const watched: string[] = [];

    await updates({ action: 'watch', target: 'r1', interval: 10 }, (l) => watched.push(l));
    expect(watched.map((l) => l.split(' ')[6])).toEqual(['running', 'completed']);

    const bundle = join(process.env['XDG_CONFIG_HOME'] as string, 'bundle.tar');

    await writeFile(bundle, Buffer.alloc(70_000, 1));

    const uploaded: string[] = [];

    await updates({ action: 'upload', target: bundle }, (l) => uploaded.push(l));
    expect(uploaded).toEqual(['Imported 3.5.1 (available, signed)']);
    expect(requests.at(-1)).toMatchObject({ path: '/api/updates/bundles', type: 'application/x-tar' });
    expect(requests.at(-1)?.body.length).toBe(70_000);

    await expect(updates({ action: 'nope' }, () => undefined)).rejects.toThrow(/status\|releases/);
    await expect(updates({ action: 'pause' }, () => undefined)).rejects.toThrow('updates pause <id>');
  });

  it('prints its own and the control plane version', async () => {
    const out: string[] = [];

    await version((l) => out.push(l), '3.5.0');
    expect(out).toEqual(['loadweaver CLI 3.5.0', `control plane 3.5.0 (${process.env['LOADWEAVER_URL']})`]);
  });

  it('warns once when it is more than one release line behind', () => {
    const warnings: string[] = [];

    resetVersionWarning();
    checkClusterVersion('3.5.0', (l) => warnings.push(l), '3.4.2');
    checkClusterVersion('3.5.0', (l) => warnings.push(l), '3.3.9');
    checkClusterVersion('3.6.0', (l) => warnings.push(l), '3.3.9');
    checkClusterVersion('3.5.0', (l) => warnings.push(l), '0.0.0-dev');
    expect(warnings).toEqual([
      'loadweaver: this CLI (3.3.9) is more than one release behind the control plane (3.5.0); update it',
    ]);
    resetVersionWarning();
  });
});
