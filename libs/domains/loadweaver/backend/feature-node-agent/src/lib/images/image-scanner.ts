import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import {
  agentMessage,
  type Envelope,
  type ImageScan,
  type WorkloadSpec,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type Docker from 'dockerode';

import { DOCKER } from '../host/docker.provider';
import { ManagedContainers } from '../host/managed-containers';
import { AgentStateStore } from '../state/agent-state.store';

/** Pinned by digest (section 6); overridden by the release bundle (3.26). */
export const DEFAULT_TRIVY_IMAGE =
  'docker.io/aquasec/trivy:0.76.0@sha256:2416d1f74045b57274df1a340eee6b510cacd73c66a6ccb8da092b117eb7d222';
const SCANNER = 'trivy 0.76.0';
/** Scans of a digest are repeated after this long (new vulnerabilities are found in old images). */
const RESCAN_AFTER_MS = 24 * 3_600_000;
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
const MAX_FINDINGS = 50;

interface TrivyReport {
  Results?: {
    Vulnerabilities?: {
      VulnerabilityID: string;
      PkgName: string;
      InstalledVersion: string;
      FixedVersion?: string;
      Severity: string;
    }[];
  }[];
}

/** Counts and the most severe findings of a Trivy JSON report. */
export function summarizeTrivy(report: TrivyReport): Pick<ImageScan, 'counts' | 'findings'> {
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, { total: 0, fixable: 0 }])) as ImageScan['counts'];
  const findings: ImageScan['findings'] = [];
  const seen = new Set<string>();

  for (const result of report.Results ?? []) {
    for (const v of result.Vulnerabilities ?? []) {
      const key = `${v.VulnerabilityID}|${v.PkgName}|${v.InstalledVersion}`;

      if (seen.has(key)) continue;

      seen.add(key);

      const severity = (SEVERITIES as readonly string[]).includes(v.Severity)
        ? (v.Severity as (typeof SEVERITIES)[number])
        : 'UNKNOWN';

      counts[severity].total++;

      if (v.FixedVersion) counts[severity].fixable++;

      findings.push({
        id: v.VulnerabilityID.slice(0, 128),
        severity,
        package: v.PkgName.slice(0, 256),
        installed: v.InstalledVersion.slice(0, 128),
        fixed: v.FixedVersion ? v.FixedVersion.slice(0, 256) : null,
      });
    }
  }

  findings.sort(
    (a, b) =>
      SEVERITIES.indexOf(a.severity as never) - SEVERITIES.indexOf(b.severity as never) || a.id.localeCompare(b.id),
  );

  return { counts, findings: findings.slice(0, MAX_FINDINGS) };
}

/** Findings an image policy blocks (fixable only, unless unfixed ones count too). */
const RESCAN_CHECK_MS = 3_600_000;

export function blockedBy(
  scan: Pick<ImageScan, 'counts'>,
  policy: NonNullable<WorkloadSpec['imagePolicy']>[number],
): number {
  return policy.block.reduce(
    (sum, s) => sum + (policy.ignoreUnfixed ? scan.counts[s].fixable : scan.counts[s].total),
    0,
  );
}

/**
 * Scans pulled images for known vulnerabilities (3.22) with Trivy: the image is saved to a file (Trivy never gets
 * the Docker socket), scanned offline from the vulnerability database it keeps in a cache, and the result reported to
 * the control plane. A digest is scanned once a day at most.
 */
@Injectable()
export class ImageScanner {
  private readonly logger = new Logger(ImageScanner.name);
  private send: ((envelope: Envelope) => void) | null = null;
  private readonly running = new Map<string, Promise<ImageScan | null>>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(DOCKER) private readonly docker: Docker,
    private readonly containers: ManagedContainers,
    private readonly state: AgentStateStore,
  ) {}

  attach(send: (envelope: Envelope) => void): void {
    this.send = send;
  }

  private tracked: { image: string; digest: string }[] = [];
  private timer: NodeJS.Timeout | null = null;

  /**
   * Images of the running workloads: rescanned once a day while they run, so new vulnerabilities in images that
   * don't change still reach the reports and plans (3.22).
   */
  track(images: { image: string; digest: string }[]): void {
    this.tracked = images;
    this.timer ??= setInterval(() => void this.rescan(), RESCAN_CHECK_MS).unref();
  }

  async rescan(): Promise<void> {
    for (const { image, digest } of this.tracked) await this.scan(image, digest).catch(() => null);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private get dir(): string {
    return join(this.state.dir, 'image-scans');
  }

  private async cached(digest: string): Promise<(ImageScan & { at: number }) | null> {
    const file = join(this.dir, `${digest.replace(':', '-')}.json`);
    const raw = await readFile(file, 'utf8').catch(() => null);

    if (!raw) return null;

    try {
      return JSON.parse(raw) as ImageScan & { at: number };
    } catch {
      // A damaged cache entry is just a missing one: scan again.
      await rm(file, { force: true });

      return null;
    }
  }

  /** The scan of a local image, fresh enough or made now; null when it can't be scanned (e.g. no space). */
  async scan(image: string, digest: string): Promise<ImageScan | null> {
    const cached = await this.cached(digest);

    if (cached && Date.now() - cached.at < RESCAN_AFTER_MS) return cached;

    let pending = this.running.get(digest);

    if (!pending) {
      // One scan at a time on a node: each needs the saved image on disk and Trivy's memory.
      const run = this.queue.then(() => this.scanNow(image, digest));

      this.queue = run.catch(() => undefined);
      pending = run.finally(() => this.running.delete(digest));
      this.running.set(digest, pending);
    }

    return (await pending) ?? cached;
  }

  private async scanNow(image: string, digest: string): Promise<ImageScan | null> {
    const work = join(this.dir, 'work', digest.replace(':', '-'));
    const cache = join(this.dir, 'cache');

    await mkdir(join(work, 'out'), { recursive: true, mode: 0o700 });
    await mkdir(cache, { recursive: true, mode: 0o700 });

    try {
      // Only with room for the saved image (plus margin): scans must never fill the node's disk.
      const size = ((await this.docker.getImage(image).inspect()) as { Size?: number }).Size ?? 0;
      const fs = await statfs(work);

      if (Number(fs.bavail) * Number(fs.bsize) < size * 1.5 + 512 * 1024 ** 2) {
        this.logger.warn(`Not scanning ${image}: not enough disk space for the saved image`);

        return null;
      }

      await pipeline(
        (await this.docker.getImage(image).get()) as NodeJS.ReadableStream,
        createWriteStream(join(work, 'image.tar'), { mode: 0o600 }),
      );

      const result = await this.containers.runOnce(
        process.env['LOADWEAVER_TRIVY_IMAGE'] || DEFAULT_TRIVY_IMAGE,
        [
          'trivy',
          'image',
          '--input',
          '/scan/image.tar',
          '--format',
          'json',
          '--output',
          '/out/report.json',
          '--quiet',
          '--scanners',
          'vuln',
          '--cache-dir',
          '/cache',
          '--timeout',
          '15m',
        ],
        [`${work}:/scan:ro`, `${join(work, 'out')}:/out`, `${cache}:/cache`],
        // The vulnerability database is downloaded (and cached) from the internet. As the agent's own user, which owns
        // the directories (root without capabilities couldn't use them otherwise).
        { network: 'bridge', memoryBytes: 2 * 1024 ** 3, user: String(process.getuid?.() ?? 0) },
      );

      if (result.exitCode !== 0) throw new Error(result.output.trim().slice(-500));

      const report = JSON.parse(await readFile(join(work, 'out', 'report.json'), 'utf8')) as TrivyReport;
      const scan: ImageScan = { image, digest, scanner: SCANNER, ...summarizeTrivy(report) };

      // Atomically, so a full disk can't leave a half-written entry behind.
      const target = join(this.dir, `${digest.replace(':', '-')}.json`);

      await writeFile(`${target}.tmp`, JSON.stringify({ ...scan, at: Date.now() }), { mode: 0o600 });
      await rename(`${target}.tmp`, target);
      this.send?.(agentMessage('imageScan', scan));

      return scan;
    } catch (error) {
      this.logger.warn(`Scan of ${image} failed: ${error instanceof Error ? error.message : String(error)}`);

      return null;
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
}
