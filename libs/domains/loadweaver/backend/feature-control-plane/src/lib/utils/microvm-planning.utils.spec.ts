import { workloadSpecSchema } from '@forepath/loadweaver/shared/util-agent-protocol';
import { projectSpecSchema } from '@forepath/loadweaver/shared/util-model';

import {
  compileMicrovm,
  DEFAULT_MICROVM_ROOTFS_BYTES,
  imageArchitectures,
  isBundledMicrovmImage,
  microvmHealthcheck,
  microvmIssues,
  microvmProcess,
  microvmRequests,
  microvmSizing,
  type ImageInspection,
} from './microvm-planning.utils';
import { buildWorkloadSpec, translateDeployments, withImageArchitectures } from './workload-planning.utils';

const MiB = 1024 ** 2;
const sha = (c: string) => `sha256:${c.repeat(64)}`;
const LAUNCHER = 'ghcr.io/forepath/microvm-launcher:test';

const COMPOSE = `
services:
  app:
    image: registry.lw/shop/app:1
    x-loadweaver: { runtime: microvm, microvm: { rootfsSize: 2Gi } }
    command: [serve, --port, '80']
    environment: { MODE: prod, PATH: /custom }
    healthcheck: { test: 'curl -f http://localhost', interval: 10s, start_period: 5s }
    cap_add: [NET_ADMIN]
  agent:
    image: ghcr.io/forepath/agenstra-worker-microvm:1
    x-loadweaver: { runtime: microvm }
  small:
    image: alpine:3
    x-loadweaver: { runtime: microvm }
`;

const { parsed } = translateDeployments(
  [{ project: 'shop', name: 'store', spec: { compose: COMPOSE } }],
  new Map([['shop', projectSpecSchema.parse({})]]),
);
const d = parsed[0];
const svc = (name: string) => d.compose.services.find((s) => s.name === name)!;

const generic: ImageInspection = {
  manifestDigest: sha('b'),
  platform: 'linux/amd64',
  platforms: ['linux/amd64', 'linux/arm64'],
  labels: { 'org.opencontainers.image.title': 'app' },
  config: {
    entrypoint: ['/entrypoint.sh'],
    cmd: ['default'],
    env: ['PATH=/usr/bin', 'LANG=C.UTF-8'],
    user: 'app',
    workingDir: '/srv',
    stopSignal: 'SIGQUIT',
  },
  layers: [
    { digest: sha('1'), diffId: sha('2'), size: 1000, mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip' },
    { digest: sha('3'), diffId: sha('4'), size: 2000, mediaType: 'application/vnd.oci.image.layer.v1.tar+zstd' },
  ],
};
const bundled: ImageInspection = { ...generic, labels: { 'io.agenstra.microvm.protocol': '1' }, layers: [] };

describe('microVM planning (M7.2)', () => {
  it('sizes the guest from limits, requests or the defaults', () => {
    expect(microvmSizing(svc('small'))).toEqual({ vcpus: 1, memoryMiB: 512 });
    expect(
      microvmSizing({
        resources: {
          requests: { cpuMillis: 1500, memoryBytes: 300 * MiB },
          limits: { memoryBytes: 2048 * MiB },
          source: 'compose',
        },
      }),
    ).toEqual({ vcpus: 2, memoryMiB: 2048 });
    expect(
      microvmSizing({
        resources: { requests: { cpuMillis: 100, memoryBytes: 64 * MiB }, limits: {}, source: 'compose' },
      }),
    ).toEqual({ vcpus: 1, memoryMiB: 128 });
  });

  it('adds the launcher overhead to the scheduler requests', () => {
    // Project default request 256 MiB, guest default 512 MiB: the guest memory counts, plus 384 MiB.
    expect(microvmRequests(svc('small'))).toEqual({ cpuMillis: 250 + 250, memoryBytes: (512 + 384) * MiB });
  });

  it('runs health checks inside the guest through vm-exec with the boot budget', () => {
    expect(
      microvmHealthcheck({
        test: ['CMD-SHELL', 'curl -f x'],
        intervalMs: 1,
        timeoutMs: 1,
        retries: 1,
        startPeriodMs: 5000,
      }),
    ).toEqual({
      test: ['CMD', '/usr/lib/agenstra-microvm/vm-exec', '--', '/bin/sh', '-c', 'curl -f x'],
      intervalMs: 1,
      timeoutMs: 1,
      retries: 1,
      startPeriodMs: 20_000,
    });
    expect(
      microvmHealthcheck({ test: ['CMD', 'true'], intervalMs: 1, timeoutMs: 1, retries: 1, startPeriodMs: 0 })?.test,
    ).toEqual(['CMD', '/usr/lib/agenstra-microvm/vm-exec', '--', 'true']);
    expect(microvmHealthcheck(undefined)).toBeUndefined();
  });

  it('merges the image process with the compose overrides (Docker rules)', () => {
    expect(microvmProcess(svc('app'), generic)).toEqual({
      entrypoint: ['/entrypoint.sh'],
      cmd: ['serve', '--port', '80'],
      env: ['LANG=C.UTF-8', 'MODE=prod', 'PATH=/custom'],
      user: 'app',
      workingDir: '/srv',
      stopSignal: 'SIGQUIT',
    });
    // A compose entrypoint resets the image command; no user / workdir in the image: root, /.
    expect(
      microvmProcess({ ...svc('small'), entrypoint: ['/bin/x'] }, { ...generic, config: { cmd: ['ignored'] } }),
    ).toMatchObject({ entrypoint: ['/bin/x'], cmd: [], user: 'root', workingDir: '/', stopSignal: 'SIGTERM' });
  });

  it('detects Agenstra bundled images by their bridge label', () => {
    expect(isBundledMicrovmImage(bundled)).toBe(true);
    expect(isBundledMicrovmImage(generic)).toBe(false);
    expect(isBundledMicrovmImage({ labels: { 'io.agenstra.microvm.protocol': '2' } })).toBe(false);
    expect(isBundledMicrovmImage(undefined)).toBe(false);
  });

  it('compiles generic microVMs onto the launcher with the pinned image as guest root', () => {
    const image = `registry.lw/shop/app:1@${sha('c')}`;
    const compiled = compileMicrovm(svc('app'), image, generic, LAUNCHER);

    expect(compiled).toMatchObject({
      generic: true,
      image: LAUNCHER,
      microvm: {
        mode: 'generic',
        guestImage: image,
        layers: generic.layers,
        vcpus: 1,
        memoryMiB: 512,
        rootfsBytes: 2 * 1024 ** 3,
        process: { cmd: ['serve', '--port', '80'] },
      },
      healthcheck: {
        test: ['CMD', '/usr/lib/agenstra-microvm/vm-exec', '--', '/bin/sh', '-c', 'curl -f http://localhost'],
      },
    });
  });

  it('runs bundled images as their own launcher', () => {
    const image = `ghcr.io/forepath/agenstra-worker-microvm:1@${sha('d')}`;

    expect(compileMicrovm(svc('agent'), image, bundled, LAUNCHER)).toEqual({
      generic: false,
      image,
      microvm: { mode: 'bundled', vcpus: 1, memoryMiB: 512, rootfsBytes: DEFAULT_MICROVM_ROOTFS_BYTES },
    });
  });

  it('builds a valid workload spec without the guest process on the launcher container', () => {
    const image = `registry.lw/shop/app:1@${sha('c')}`;
    const spec = buildWorkloadSpec(d, svc('app'), 0, ['10.0.0.9'], 'lw', {
      images: { app: image },
      secretVersions: {},
      imageConfigs: { app: generic },
    });

    expect(workloadSpecSchema.safeParse(spec).success).toBe(true);
    expect(spec.image).not.toBe(image);
    expect(spec).toMatchObject({ runtime: 'runc', isolation: 'microvm', capAdd: [], capDrop: [] });
    expect(spec).not.toHaveProperty('command');
    expect(spec).not.toHaveProperty('entrypoint');
    expect(spec).not.toHaveProperty('stopSignal');
    expect(spec.microvm?.guestImage).toBe(image);
  });

  it('reports plan-time problems of the image', () => {
    expect(microvmIssues(svc('app'), generic)).toEqual([
      expect.objectContaining({ level: 'warning', path: 'services.app.healthcheck' }),
    ]);
    expect(microvmIssues(svc('small'), { ...generic, config: {} })).toContainEqual(
      expect.objectContaining({ level: 'error', message: expect.stringContaining('no entrypoint or command') }),
    );
    expect(microvmIssues(svc('small'), { ...generic, labels: { 'io.agenstra.microvm.protocol': '9' } })).toContainEqual(
      expect.objectContaining({ level: 'error', message: expect.stringContaining('bridge protocol 9') }),
    );
    expect(
      microvmIssues(svc('small'), {
        ...generic,
        vmImage: { arch: 'amd64', format: 'qcow2', layerDigest: sha('e'), virtualSize: 1, firmware: ['uefi'] },
      }),
    ).toContainEqual(expect.objectContaining({ level: 'error', message: expect.stringContaining('VirtualMachine') }));
    expect(microvmIssues(svc('agent'), bundled)).toEqual([]);
  });

  describe('mixed-arch clusters (3.35)', () => {
    const armLayers = [
      { digest: sha('7'), diffId: sha('8'), size: 900, mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip' },
    ];
    const multi: ImageInspection = { ...generic, platformLayers: { arm64: armLayers, amd64: generic.layers } };

    it('emits platformLayers instead of layers when the image was inspected for several architectures', () => {
      const compiled = compileMicrovm(svc('app'), `registry.lw/shop/app@${sha('b')}`, multi, LAUNCHER);

      expect(compiled.microvm?.layers).toBeUndefined();
      expect(compiled.microvm?.platformLayers).toEqual({ amd64: generic.layers, arm64: armLayers });
      expect(Object.keys(compiled.microvm?.platformLayers ?? {})).toEqual(['amd64', 'arm64']);

      const spec = buildWorkloadSpec(d, svc('app'), 0, ['10.0.0.2'], 'lw.internal', {
        images: { app: `registry.lw/shop/app@${sha('b')}` },
        secretVersions: {},
        imageConfigs: { app: multi },
      });

      expect(workloadSpecSchema.safeParse(spec).success).toBe(true);
    });

    it('keeps the single-arch layers (and spec hash) without platformLayers', () => {
      const pinned = { images: { app: `registry.lw/shop/app@${sha('b')}` }, secretVersions: {} };
      const single = buildWorkloadSpec(d, svc('app'), 0, ['10.0.0.2'], 'lw.internal', {
        ...pinned,
        imageConfigs: { app: generic },
      });

      expect(single.microvm?.layers).toHaveLength(2);
      expect(single.microvm?.platformLayers).toBeUndefined();
      expect(
        buildWorkloadSpec(d, svc('app'), 0, ['10.0.0.2'], 'lw.internal', {
          ...pinned,
          imageConfigs: { app: { ...generic } },
        }).specHash,
      ).toBe(single.specHash);
    });

    it('derives the image architectures for the scheduler', () => {
      expect(imageArchitectures(multi)).toEqual(['amd64', 'arm64']);
      expect(imageArchitectures(generic)).toEqual(['amd64']);
      expect(imageArchitectures({ ...generic, platform: 'linux/arm64/v8' })).toEqual(['arm64']);
      expect(
        imageArchitectures({
          ...generic,
          vmImage: { arch: 'arm64', format: 'qcow2', layerDigest: sha('9'), virtualSize: 1, firmware: ['uefi'] },
        }),
      ).toEqual(['arm64']);
      expect(imageArchitectures(undefined)).toBeUndefined();

      const services = d.compose.services.map((s) => ({
        id: `shop/store/${s.name}`,
        project: 'shop',
        replicas: 1,
        requests: { cpuMillis: 100, memoryBytes: MiB },
        runtime: s.runtime,
        spread: 'node' as const,
        volumes: [],
      }));
      const withArches = withImageArchitectures(services, [d], new Map([['shop/store', { app: multi }]]));

      expect(withArches.find((s) => s.id === 'shop/store/app')?.architectures).toEqual(['amd64', 'arm64']);
      expect(withArches.find((s) => s.id === 'shop/store/small')?.architectures).toBeUndefined();
    });
  });
});
