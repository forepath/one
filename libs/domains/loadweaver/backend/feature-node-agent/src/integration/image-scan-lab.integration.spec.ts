import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Docker from 'dockerode';

import { ManagedContainers } from '../lib/host/managed-containers';
import { blockedBy, ImageScanner } from '../lib/images/image-scanner';

/**
 * Image scanning on a real Docker and a real Trivy (3.22): an old image with known vulnerabilities is saved to a
 * file (Trivy never sees the Docker socket), scanned, summarized, reported and kept for a day.
 */

const OLD_ALPINE =
  'docker.io/library/alpine:3.10.9@sha256:451eee8bedcb2f029756dc3e9d73bab0e7943c1ac55cff3a4861c52a0fdd3e98';

describe('image scanning (lab)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lw-scan-lab-'));
  const docker = new Docker();
  const reports: unknown[] = [];
  const scanner = new ImageScanner(docker, new ManagedContainers(docker), { dir } as never);

  beforeAll(() => {
    execFileSync('docker', ['pull', '-q', OLD_ALPINE], { stdio: 'ignore' });
    scanner.attach((envelope) => reports.push(envelope));
  }, 300_000);

  afterAll(() => {
    // Trivy wrote its cache as root inside its container.
    execFileSync('docker', ['run', '--rm', '-v', `${dir}:/d`, '--entrypoint', 'sh', OLD_ALPINE, '-c', 'rm -rf /d/*']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds the known vulnerabilities of an end-of-life image and reports them once a day', async () => {
    const digest = OLD_ALPINE.split('@')[1];
    const scan = await scanner.scan(OLD_ALPINE, digest);

    expect(scan).not.toBeNull();

    const total = Object.values(scan?.counts ?? {}).reduce((sum, c) => sum + c.total, 0);

    expect(total).toBeGreaterThan(0);
    expect(scan?.findings[0].id).toMatch(/^CVE-/);
    expect(
      blockedBy(scan as never, { mode: 'enforce', block: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'], ignoreUnfixed: false }),
    ).toBe(total - (scan?.counts.UNKNOWN.total ?? 0));
    expect(reports).toHaveLength(1);
    // Fresh: from the cache, no second scan or report.
    expect(await scanner.scan(OLD_ALPINE, digest)).toMatchObject({ digest, scanner: 'trivy 0.76.0' });
    expect(reports).toHaveLength(1);
  }, 900_000);
});
