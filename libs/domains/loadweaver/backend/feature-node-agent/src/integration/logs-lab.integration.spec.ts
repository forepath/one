import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LogEntry } from '@forepath/loadweaver/shared/util-agent-protocol';
import Docker from 'dockerode';

import { CommandRunner } from '../lib/host/command-runner';
import { LogCollectorsService } from '../lib/logs/log-collectors.service';
import { LogShipper } from '../lib/logs/log-shipper';
import { MetricsCollectorService } from '../lib/metrics/metrics-collector.service';
import { secretDir } from '../lib/workloads/workload-container';

/**
 * Log collection on a real Docker (3.14): a workload's output is followed with its labels and stream, the secret the
 * node delivered to it is redacted before anything leaves the node, and its exit shows up as a runtime event.
 */

const ALPINE =
  'docker.io/library/alpine:3.10.9@sha256:451eee8bedcb2f029756dc3e9d73bab0e7943c1ac55cff3a4861c52a0fdd3e98';

describe('log collection (lab)', () => {
  const runtime = mkdtempSync(join(tmpdir(), 'lw-logs-lab-'));
  const name = `lw-logs-lab-${process.pid}-${Date.now()}`;
  const env = { ...process.env };
  const shipped: LogEntry[] = [];
  const docker = new Docker();
  let collectors: LogCollectorsService;

  beforeAll(() => {
    process.env['LOADWEAVER_RUNTIME_DIR'] = runtime;

    const dir = secretDir(runtime, 'shop/site/web/0');

    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'db-password'), 's3cr3t-value\n');
    execFileSync('docker', ['pull', '-q', ALPINE], { stdio: 'ignore' });

    const shipper = new LogShipper();

    jest.spyOn(shipper, 'push').mockImplementation((entry) => void shipped.push(entry));
    collectors = new LogCollectorsService(
      docker,
      new CommandRunner(),
      shipper,
      new MetricsCollectorService(docker, new CommandRunner(), {} as never),
    );
  }, 120_000);

  afterAll(() => {
    collectors?.onModuleDestroy();
    process.env = env;

    try {
      execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    } catch {
      // gone
    }

    rmSync(runtime, { recursive: true, force: true });
  });

  it('ships labelled, redacted output and lifecycle events', async () => {
    collectors.start();
    execFileSync('docker', [
      'run',
      '-d',
      '--memory',
      '128m',
      '--name',
      name,
      '--label',
      'loadweaver.com/managed=true',
      '--label',
      'loadweaver.com/workload=shop/site/web/0',
      ALPINE,
      'sh',
      '-c',
      'sleep 2; echo "listening on :8080"; echo "connecting with password s3cr3t-value" >&2; sleep 3; exit 3',
    ]);
    await collectors.refreshContainers();

    for (let i = 0; i < 60 && !shipped.some((e) => e.source === 'runtime' && e.message.includes('die')); i++)
      await new Promise((r) => setTimeout(r, 500));

    const output = shipped.filter((e) => e.source === 'container');

    expect(output).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'info',
          message: 'listening on :8080',
          labels: { project: 'shop', deployment: 'site', service: 'web', replica: 'shop/site/web/0', stream: 'stdout' },
        }),
        expect.objectContaining({
          level: 'warn',
          message: 'connecting with password [redacted]',
          labels: expect.objectContaining({ stream: 'stderr' }),
        }),
      ]),
    );
    expect(JSON.stringify(shipped)).not.toContain('s3cr3t-value');
    expect(shipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'runtime',
          level: 'warn',
          message: expect.stringContaining('die (exit code 3)'),
          labels: { project: 'shop', deployment: 'site', service: 'web', replica: 'shop/site/web/0' },
        }),
      ]),
    );
  }, 60_000);
});
