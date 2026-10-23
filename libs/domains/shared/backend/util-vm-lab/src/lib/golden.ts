import { appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { docker, dockerOk, run, tarFiles } from './process';

/**
 * Golden images: a pinned cloud image (Debian 13 for Loadweaver, Ubuntu 22.04 for Agenstra) booted once under QEMU in
 * a container (`--device /dev/kvm`) and provisioned by cloud-init, stored as a qcow2 in a Docker volume whose name is
 * the content hash of every pin and script (the products compute it, so existing cached volumes keep their names).
 * Lab VMs are qcow2 overlays on it. The golden specs (pins, provisioning) stay in their products.
 */

export interface GoldenSpec {
  /** Docker volume holding the golden image (content-addressed by the product). */
  volume: string;
  /** QEMU image (with `qemu-system-x86_64`, `qemu-img`, `cloud-localds`, `curl`). */
  qemuImage: string;
  /** Where the build container mounts the volume. */
  mountPath: string;
  /** File (relative to the volume) whose existence means "built". */
  readyFile: string;
  /** Labels of the volume. */
  volumeLabels: Record<string, string>;
  /** Labels of the build container. */
  buildLabels: Record<string, string>;
  /** Fixed build container name (removed before the build), if any. */
  buildContainerName?: string;
  /** Files put into the volume before the build (cloud-init seed sources). */
  files?: Record<string, string | Buffer>;
  /** The build script (`sh -c` / `bash -c` in the QEMU image, working on `mountPath`). */
  script: string;
  shell?: 'sh' | 'bash';
  env?: Record<string, string>;
  /** Container memory of the build (guest + QEMU). */
  memoryMb: number;
  timeoutMs: number;
  /** Lines of the build output worth logging (progress markers); all output goes to the log file. */
  progress?: RegExp;
  /** Formats a progress line for the log. */
  formatProgress?: (line: string) => string;
}

export interface GoldenInfo {
  volume: string;
  built: boolean;
  seconds: number;
}

export async function goldenReady(spec: Pick<GoldenSpec, 'volume' | 'qemuImage' | 'readyFile'>): Promise<boolean> {
  return (
    (await dockerOk(['volume', 'inspect', spec.volume])) &&
    (
      await run('docker', [
        'run',
        '--rm',
        '-v',
        `${spec.volume}:/g:ro`,
        spec.qemuImage,
        'test',
        '-f',
        `/g/${spec.readyFile}`,
      ])
    ).code === 0
  );
}

/** Builds the golden image once into its volume, or reuses it. */
export async function ensureGoldenVolume(
  spec: GoldenSpec,
  log: (line: string) => void = () => undefined,
): Promise<GoldenInfo> {
  const start = Date.now();

  if (await goldenReady(spec)) return { volume: spec.volume, built: false, seconds: 0 };

  const logFile = join(tmpdir(), `${spec.volume}.log`);
  const labels = (l: Record<string, string>) => Object.entries(l).flatMap(([k, v]) => ['--label', `${k}=${v}`]);

  writeFileSync(logFile, '');
  log(`building golden image ${spec.volume} (log: ${logFile}); this takes several minutes`);
  await docker(['volume', 'create', ...labels(spec.volumeLabels), spec.volume]);

  if (spec.files && Object.keys(spec.files).length > 0)
    await docker(
      [
        'run',
        '-i',
        '--rm',
        '-v',
        `${spec.volume}:${spec.mountPath}`,
        spec.qemuImage,
        'tar',
        '-C',
        spec.mountPath,
        '-xf',
        '-',
      ],
      { input: await tarFiles(spec.files) },
    );

  if (spec.buildContainerName) await run('docker', ['rm', '-f', spec.buildContainerName]);

  let partial = '';
  const result = await run(
    'docker',
    [
      'run',
      '--rm',
      ...(spec.buildContainerName ? ['--name', spec.buildContainerName] : []),
      ...labels(spec.buildLabels),
      '--device',
      '/dev/kvm',
      '--memory',
      `${spec.memoryMb}m`,
      '-v',
      `${spec.volume}:${spec.mountPath}`,
      ...Object.entries(spec.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      spec.qemuImage,
      spec.shell ?? 'sh',
      '-c',
      spec.script,
    ],
    {
      timeoutMs: spec.timeoutMs,
      onStdout: (chunk) => {
        const lines = (partial + chunk).split('\n');

        partial = lines.pop() ?? '';
        appendFileSync(logFile, chunk);

        if (spec.progress)
          for (const line of lines)
            if (spec.progress.test(line))
              log(spec.formatProgress ? spec.formatProgress(line) : `golden: ${line.trim()}`);
      },
    },
  );

  if (result.code !== 0 || !(await goldenReady(spec)))
    throw new Error(
      `golden image build failed (exit ${result.code}); log: ${logFile}\n${(result.stderr || result.stdout).slice(-2000)}`,
    );

  const seconds = Math.round((Date.now() - start) / 1000);

  return { volume: spec.volume, built: true, seconds };
}
