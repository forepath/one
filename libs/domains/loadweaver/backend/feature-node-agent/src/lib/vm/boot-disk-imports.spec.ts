import type { VolumeAssignment, WorkloadSpec } from '@forepath/loadweaver/shared/util-agent-protocol';

import { WorkloadDeferred } from '../workloads/workload.manager';
import { BootDiskImports, vmImportConcurrency, type BootDiskImportEvent } from './boot-disk-imports';
import type { VmImportOptions } from './vm-image-import';

const DIGEST = `sha256:${'c'.repeat(64)}`;
const OTHER = `sha256:${'d'.repeat(64)}`;
const IMAGE = {
  ref: 'registry.lw.internal/shop/debian:13',
  digest: `sha256:${'1'.repeat(64)}`,
  format: 'qcow2' as const,
  layerDigest: DIGEST,
};
const LAUNCHER = 'ghcr.io/forepath/microvm-launcher:1.0.0';

const tick = () => new Promise((resolve) => setImmediate(resolve));

const volume = (id: string, digest = DIGEST): VolumeAssignment => ({
  id,
  dockerName: `lw-vol-${id.replace(/\//g, '.')}`,
  minor: 1000,
  port: 7800,
  sizeBytes: 1024 ** 3,
  replicas: [{ node: 'n1', nodeId: 0, address: '10.93.0.1' }],
  connections: [],
  primary: 'n1',
  keyRef: 'secret://shop/lw-volume-x',
  mode: 'block',
  initializeFrom: { digest, format: 'qcow2' },
});

const vmSpec = (name: string): WorkloadSpec =>
  ({
    id: `shop/lw-vm/${name}/0`,
    specHash: 'h1',
    vm: { disks: [{ name: 'root', volume: `shop/lw-vm/${name}.root`, boot: true }] },
  }) as unknown as WorkloadSpec;

function setup(options: { concurrency?: number } = {}) {
  const assignments = new Map(['a', 'b', 'c'].map((n) => [`shop/lw-vm/${n}.root`, volume(`shop/lw-vm/${n}.root`)]));
  const calls: string[] = [];
  const writes = new Map<string, { resolve: () => void; reject: (error: Error) => void; options: VmImportOptions }>();
  let clock = 1_000_000;
  const importer = {
    prepareBootDisk: jest.fn(
      async (id: string): Promise<{ device: string; import?: { digest: string; format: 'qcow2' } }> => {
        calls.push(`prepare ${id}`);

        return { device: '/dev/drbd1000', import: { digest: DIGEST, format: 'qcow2' as const } };
      },
    ),
    importBootDisk: jest.fn(
      (id: string, _device: string, _layer: unknown, _launcher: string, opts: VmImportOptions = {}) =>
        new Promise<void>((resolve, reject) => {
          calls.push(`import ${id}`);
          writes.set(id, { resolve, reject, options: opts });
          opts.signal?.addEventListener('abort', () => reject(opts.signal?.reason as Error), { once: true });
        }),
    ),
  };
  const volumes = {
    assignment: jest.fn((id: string) => assignments.get(id)),
    demoteBlock: jest.fn(async (id: string) => void calls.push(`demote ${id}`)),
  };
  const events: BootDiskImportEvent[] = [];
  const imports = new BootDiskImports(importer, volumes as never, (event) => events.push(event), {
    concurrency: options.concurrency ?? 2,
    retryMs: 60_000,
    maxRetryMs: 240_000,
    now: () => clock,
  });
  const ensure = (name: string) =>
    imports.ensure({ replica: `shop/lw-vm/${name}/0`, specHash: 'h1' }, `shop/lw-vm/${name}.root`, IMAGE, LAUNCHER);

  return {
    imports,
    importer,
    volumes,
    assignments,
    calls,
    writes,
    events,
    ensure,
    advance: (ms: number) => (clock += ms),
  };
}

describe('BootDiskImports (F3b)', () => {
  it('reads the node concurrency from the environment', () => {
    expect(vmImportConcurrency({})).toBe(2);
    expect(vmImportConcurrency({ LOADWEAVER_VM_IMPORT_CONCURRENCY: '4' })).toBe(4);
    expect(vmImportConcurrency({ LOADWEAVER_VM_IMPORT_CONCURRENCY: '0' })).toBe(2);
    expect(vmImportConcurrency({ LOADWEAVER_VM_IMPORT_CONCURRENCY: 'x' })).toBe(2);
  });

  it('hands out a disk that needs no import right away', async () => {
    const { imports, importer, ensure } = setup();

    importer.prepareBootDisk.mockResolvedValueOnce({ device: '/dev/drbd1000' });
    expect(await ensure('a')).toBe('/dev/drbd1000');
    expect(importer.importBootDisk).not.toHaveBeenCalled();
    expect(imports.reportable()).toEqual([]);
  });

  it('runs at most `concurrency` imports at once, one per disk, the rest queued', async () => {
    const { imports, importer, writes, ensure } = setup();

    for (const name of ['a', 'b', 'c']) await expect(ensure(name)).rejects.toBeInstanceOf(WorkloadDeferred);

    // Observing again never starts a second job for a disk.
    await expect(ensure('a')).rejects.toBeInstanceOf(WorkloadDeferred);
    await tick();
    expect(importer.prepareBootDisk).toHaveBeenCalledTimes(3);
    expect(importer.importBootDisk).toHaveBeenCalledTimes(2);
    expect(imports.job('shop/lw-vm/c.root')?.phase).toBe('queued');
    await expect(ensure('c')).rejects.toThrow('boot disk import queued');
    expect(BootDiskImports.progress(imports.job('shop/lw-vm/c.root') as never)).toEqual({ phase: 'queued' });

    writes.get('shop/lw-vm/a.root')?.resolve();
    await tick();
    // A slot freed: the queued one starts; the finished one is gone (its disk says `lw.init` now).
    expect(importer.importBootDisk).toHaveBeenCalledTimes(3);
    expect(imports.job('shop/lw-vm/a.root')).toBeUndefined();
    expect(imports.job('shop/lw-vm/c.root')?.phase).toBe('fetching');
  });

  it('records progress and tells listeners when a job settled', async () => {
    const { imports, writes, events, ensure } = setup();
    const settled = jest.fn();

    imports.onSettled(settled);
    await expect(ensure('a')).rejects.toBeInstanceOf(WorkloadDeferred);
    await tick();
    writes.get('shop/lw-vm/a.root')?.options.progress?.({ phase: 'fetching', bytes: 3 * 1024 ** 2 });
    await expect(ensure('a')).rejects.toThrow('fetching the VM image for the boot disk (3 MiB)');
    writes.get('shop/lw-vm/a.root')?.options.progress?.({ phase: 'writing', bytes: 10, totalBytes: 100 });
    expect(BootDiskImports.progress(imports.job('shop/lw-vm/a.root') as never)).toEqual({
      phase: 'writing',
      bytes: 10,
      totalBytes: 100,
    });
    expect(imports.holds('shop/lw-vm/a/0')).toBe(true);

    writes.get('shop/lw-vm/a.root')?.resolve();
    await tick();
    expect(settled).toHaveBeenCalledTimes(1);
    expect(imports.holds('shop/lw-vm/a/0')).toBe(false);
    expect(events.map((e) => e.labels['result'])).toEqual(['running', 'done']);
  });

  it('reports failures and retries them with backoff', async () => {
    const { imports, importer, writes, events, ensure, advance } = setup();
    const settled = jest.fn();

    imports.onSettled(settled);
    await expect(ensure('a')).rejects.toBeInstanceOf(WorkloadDeferred);
    await tick();
    writes.get('shop/lw-vm/a.root')?.reject(new Error('digest mismatch'));
    await tick();

    expect(settled).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toEqual({
      level: 'error',
      message: 'boot disk import of shop/lw-vm/a.root failed: digest mismatch',
      labels: {
        replica: 'shop/lw-vm/a/0',
        volume: 'shop/lw-vm/a.root',
        operation: 'boot-disk-import',
        result: 'failed',
      },
    });
    expect(imports.reportable().map((j) => j.phase)).toEqual(['failed']);
    // Before the retry: refused with the reason, nothing new started.
    await expect(ensure('a')).rejects.toThrow('boot disk import failed: digest mismatch');
    expect(importer.importBootDisk).toHaveBeenCalledTimes(1);

    advance(60_000);
    await expect(ensure('a')).rejects.toBeInstanceOf(WorkloadDeferred);
    await tick();
    expect(importer.importBootDisk).toHaveBeenCalledTimes(2);
    writes.get('shop/lw-vm/a.root')?.reject(new Error('digest mismatch'));
    await tick();
    // Second failure: twice the delay.
    advance(60_000);
    await expect(ensure('a')).rejects.toThrow('boot disk import failed');
    advance(60_000);
    await expect(ensure('a')).rejects.toBeInstanceOf(WorkloadDeferred);
    await tick();
    expect(importer.importBootDisk).toHaveBeenCalledTimes(3);
  });

  it('cancels jobs whose VM / disk left the node or whose image changed; queued ones never start', async () => {
    const { imports, importer, writes, calls, assignments, events, ensure } = setup({ concurrency: 1 });

    await expect(ensure('a')).rejects.toBeInstanceOf(WorkloadDeferred);
    await expect(ensure('b')).rejects.toBeInstanceOf(WorkloadDeferred);
    await expect(ensure('c')).rejects.toBeInstanceOf(WorkloadDeferred);
    await tick();

    // All three still desired: nothing happens.
    imports.desired([vmSpec('a'), vmSpec('b'), vmSpec('c')]);
    expect(writes.get('shop/lw-vm/a.root')?.options.signal?.aborted).toBe(false);

    // b (queued) is no longer desired here: dropped and demoted, never written.
    imports.desired([vmSpec('a'), vmSpec('c')]);
    await tick();
    expect(calls).toContain('demote shop/lw-vm/b.root');
    expect(imports.job('shop/lw-vm/b.root')).toBeUndefined();

    // a (running): its volume now initializes from another image → aborted, demoted after the write stopped.
    assignments.set('shop/lw-vm/a.root', volume('shop/lw-vm/a.root', OTHER));
    imports.desired([vmSpec('a'), vmSpec('c')]);
    expect(writes.get('shop/lw-vm/a.root')?.options.signal?.aborted).toBe(true);
    await tick();
    expect(calls).toContain('demote shop/lw-vm/a.root');
    expect(events.filter((e) => e.labels['result'] === 'cancelled').map((e) => e.labels['volume'])).toEqual([
      'shop/lw-vm/b.root',
      'shop/lw-vm/a.root',
    ]);
    // No failure reported for a cancellation; the free slot went to c.
    expect(events.some((e) => e.labels['result'] === 'failed')).toBe(false);
    expect(importer.importBootDisk.mock.calls.map((c) => c[0])).toEqual(['shop/lw-vm/a.root', 'shop/lw-vm/c.root']);

    // c: its volume left the node (VM deleted) → aborted; nothing to demote.
    assignments.delete('shop/lw-vm/c.root');
    imports.desired([vmSpec('c')]);
    expect(writes.get('shop/lw-vm/c.root')?.options.signal?.aborted).toBe(true);
    await tick();
    expect(calls).not.toContain('demote shop/lw-vm/c.root');
    expect(imports.reportable()).toEqual([]);
  });

  it('keeps a running import across a recreate of the same VM (new spec hash)', async () => {
    const { imports, importer } = setup();

    await expect(
      imports.ensure({ replica: 'shop/lw-vm/a/0', specHash: 'h1' }, 'shop/lw-vm/a.root', IMAGE, LAUNCHER),
    ).rejects.toBeInstanceOf(WorkloadDeferred);
    await expect(
      imports.ensure({ replica: 'shop/lw-vm/a/0', specHash: 'h2' }, 'shop/lw-vm/a.root', IMAGE, LAUNCHER),
    ).rejects.toBeInstanceOf(WorkloadDeferred);
    expect(importer.prepareBootDisk).toHaveBeenCalledTimes(1);
    expect(imports.job('shop/lw-vm/a.root')?.specHash).toBe('h2');
  });
});
