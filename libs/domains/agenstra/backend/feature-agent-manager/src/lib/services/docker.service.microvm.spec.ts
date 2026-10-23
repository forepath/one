import { Readable } from 'stream';

import { BadRequestException } from '@nestjs/common';
import Docker = require('dockerode');

import {
  buildSingleFileTar,
  extractFirstFileFromTar,
  parseEnvironmentFile,
} from '../utils/agent-environment-file.utils';
import { serializeEnvironmentFile } from '../utils/agent-environment-file.utils';

import { DockerService } from './docker.service';

jest.mock('dockerode');

const MICROVM_LABELS = {
  'io.agenstra.microvm.protocol': '1',
  'io.agenstra.environment-mount': '1',
};

/** A dockerode exec double whose stream emits `output` and whose inspect reports `exitCode`. */
function execDouble(output = '', exitCode = 0) {
  return {
    start: jest.fn().mockImplementation(async () => Readable.from(output ? [Buffer.from(output)] : [])),
    inspect: jest.fn().mockResolvedValue({ Running: false, ExitCode: exitCode }),
  };
}

function containerDouble(id: string, labels: Record<string, string> = {}) {
  return {
    id,
    inspect: jest.fn().mockResolvedValue({
      Id: id,
      Name: `/${id}`,
      State: { Running: true },
      Config: { Image: 'image', Env: [], Labels: labels },
      HostConfig: { Runtime: 'runc' },
      NetworkSettings: { Networks: {} },
      Mounts: [],
    }),
    exec: jest.fn().mockImplementation(async () => execDouble()),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    wait: jest.fn().mockResolvedValue({ StatusCode: 0 }),
    restart: jest.fn().mockResolvedValue(undefined),
    rename: jest.fn().mockResolvedValue(undefined),
    putArchive: jest.fn().mockResolvedValue(undefined),
    getArchive: jest.fn().mockRejectedValue({ statusCode: 404 }),
    logs: jest.fn().mockResolvedValue(Buffer.from('agenstra-probe-stdout\nagenstra-probe-stderr\n')),
  };
}

describe('DockerService (microvm level)', () => {
  let service: DockerService;
  let docker: Record<string, jest.Mock>;
  let containers: Map<string, ReturnType<typeof containerDouble>>;
  let imageLabels: Record<string, string>;

  beforeEach(() => {
    containers = new Map();
    imageLabels = MICROVM_LABELS;
    docker = {
      getContainer: jest.fn((id: string) => {
        if (!containers.has(id)) {
          containers.set(id, containerDouble(id));
        }

        return containers.get(id);
      }),
      getImage: jest.fn(() => ({
        inspect: jest.fn().mockResolvedValue({ Id: 'sha256:img', Config: { Labels: imageLabels } }),
      })),
      createVolume: jest.fn().mockResolvedValue({}),
      getVolume: jest.fn(() => ({ remove: jest.fn().mockResolvedValue(undefined) })),
      createContainer: jest.fn(async (options: { name?: string; Labels?: Record<string, string> }) => {
        const id = options.name ?? `created-${containers.size}`;
        const container = containerDouble(id, imageLabels);

        containers.set(id, container);

        return container;
      }),
    };
    (Docker as unknown as jest.Mock).mockImplementation(() => docker);
    service = new DockerService();
    jest.spyOn(service, 'ensureImageExists').mockResolvedValue(undefined);
  });

  describe('createContainer', () => {
    it('creates a hardened runc launcher with /dev/kvm and mounts below the guest root', async () => {
      await service.createContainer({
        name: 'agenstra-worker-1',
        image: 'registry/worker-microvm:test',
        env: { OPENCODE_SERVER_PASSWORD: 'secret' },
        volumes: [
          { hostPath: '/opt/agents/1', containerPath: '/app' },
          { hostPath: '/opt/agents', containerPath: '/opt/workspace', readOnly: true },
        ],
        runtime: 'runc',
        capDrop: ['NET_ADMIN', 'NET_RAW'],
        sharedNetworkContainerId: 'guard-1',
        microvm: true,
      });

      const options = docker.createContainer.mock.calls[0][0];

      expect(options.Env).toBeUndefined();
      expect(options.HostConfig).toEqual(
        expect.objectContaining({
          Runtime: 'runc',
          Init: false,
          NetworkMode: 'container:guard-1',
          Binds: ['/opt/agents/1:/guest/app', '/opt/agents:/guest/opt/workspace:ro'],
          Devices: [{ PathOnHost: '/dev/kvm', PathInContainer: '/dev/kvm', CgroupPermissions: 'rwm' }],
          CapDrop: ['ALL'],
          CapAdd: [
            'CHOWN',
            'DAC_OVERRIDE',
            'FOWNER',
            'FSETID',
            'SETUID',
            'SETGID',
            'MKNOD',
            'KILL',
            'SETPCAP',
            'SYS_CHROOT',
          ],
          SecurityOpt: ['no-new-privileges'],
        }),
      );
      expect(options.HostConfig.Mounts).toEqual([
        expect.objectContaining({ Type: 'volume', Target: '/guest/etc/agenstra/environment' }),
      ]);
      // Never network or system administration inside a namespace the launcher may share with the guard.
      expect(options.HostConfig.CapAdd).not.toEqual(expect.arrayContaining(['NET_ADMIN']));
      expect(options.HostConfig.CapAdd).not.toEqual(expect.arrayContaining(['NET_RAW']));
      expect(options.HostConfig.CapAdd).not.toEqual(expect.arrayContaining(['SYS_ADMIN']));

      const [archive, archiveOptions] = containers.get('agenstra-worker-1')!.putArchive.mock.calls[0];

      expect(archiveOptions).toEqual({ path: '/guest/etc/agenstra/environment' });
      expect(parseEnvironmentFile(extractFirstFileFromTar(archive))).toEqual({ OPENCODE_SERVER_PASSWORD: 'secret' });
    });

    it('refuses images that do not speak the microVM bridge protocol', async () => {
      imageLabels = { 'io.agenstra.environment-mount': '1' };

      await expect(service.createContainer({ image: 'worker:latest', microvm: true })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createContainer({ image: 'worker:latest', microvm: true })).rejects.toThrow(
        /E_MICROVM_IMAGE_UNSUPPORTED/,
      );
      expect(docker.createContainer).not.toHaveBeenCalled();
    });

    it('leaves other levels untouched', async () => {
      imageLabels = {};
      await service.createContainer({ image: 'worker:latest', volumes: [{ hostPath: '/a', containerPath: '/app' }] });

      const options = docker.createContainer.mock.calls[0][0];

      expect(options.HostConfig.Binds).toEqual(['/a:/app']);
      expect(options.HostConfig.Devices).toBeUndefined();
      expect(options.HostConfig.CapAdd).toBeUndefined();
    });
  });

  describe('exec', () => {
    it('runs commands inside the guest through vm-exec as the unprivileged VMM user', async () => {
      containers.set('vm-1', containerDouble('vm-1', MICROVM_LABELS));
      containers.get('vm-1')!.exec.mockImplementation(async () => execDouble('/home/agenstra'));

      await service.getContainerHomeDirectory('vm-1').catch(() => undefined);
      await service.getContainerHomeDirectory('vm-1').catch(() => undefined);

      const options = containers.get('vm-1')!.exec.mock.calls[0][0];

      expect(options.User).toBe('agenstra-vmm');
      expect(options.Cmd.slice(0, 4)).toEqual(['/usr/lib/agenstra-microvm/vm-exec', '--user', 'agenstra', '--']);
      expect(options.Cmd.slice(4)).toEqual(['sh', '-c', 'printf %s "${HOME:-/home/agenstra}"']);
    });

    it('detects microVM workers once per container', async () => {
      containers.set('vm-2', containerDouble('vm-2', MICROVM_LABELS));

      await expect((service as any).isMicrovmContainer('vm-2')).resolves.toBe(true);
      await expect((service as any).isMicrovmContainer('vm-2')).resolves.toBe(true);
      expect(containers.get('vm-2')!.inspect).toHaveBeenCalledTimes(1);
    });

    it('never runs an exec in the launcher when the microVM detection fails', async () => {
      const vm = containerDouble('vm-flaky', MICROVM_LABELS);

      vm.inspect.mockRejectedValue(Object.assign(new Error('daemon busy'), { statusCode: 500 }));
      containers.set('vm-flaky', vm);

      await service.getContainerHomeDirectory('vm-flaky').catch(() => undefined);

      expect(vm.exec).not.toHaveBeenCalled();
    });

    it('keeps execs of other containers unchanged', async () => {
      containers.set('runc-1', containerDouble('runc-1'));

      await service.getContainerHomeDirectory('runc-1').catch(() => undefined);

      const options = containers.get('runc-1')!.exec.mock.calls[0][0];

      expect(options.User).toBe('agenstra');
      expect(options.Cmd[0]).toBe('sh');
    });
  });

  describe('managed environment', () => {
    it('reads and rewrites the environment file below the guest root and restarts in place', async () => {
      const vm = containerDouble('vm-env', MICROVM_LABELS);

      vm.inspect.mockResolvedValue({
        Id: 'vm-env',
        Name: '/vm-env',
        State: { Running: true },
        Config: { Image: 'worker-microvm', Env: [], Labels: MICROVM_LABELS },
        HostConfig: { Runtime: 'runc' },
        NetworkSettings: { Networks: {} },
        Mounts: [{ Type: 'volume', Name: 'agenstra-env-1', Destination: '/guest/etc/agenstra/environment', RW: true }],
      });
      vm.getArchive.mockImplementation(async () =>
        Readable.from([buildSingleFileTar('environment', serializeEnvironmentFile({ KEEP: 'k' }))]),
      );
      containers.set('vm-env', vm);

      await expect(service.getEnvironmentApplyStrategy('vm-env', 'runc')).resolves.toBe('restart');
      await service.updateContainer('vm-env', { env: { ADDED: 'a' }, runtime: 'runc' });

      expect(vm.getArchive).toHaveBeenCalledWith({ path: '/guest/etc/agenstra/environment/environment' });
      expect(vm.putArchive.mock.calls[0][1]).toEqual({ path: '/guest/etc/agenstra/environment' });
      expect(parseEnvironmentFile(extractFirstFileFromTar(vm.putArchive.mock.calls[0][0]))).toEqual({
        KEEP: 'k',
        ADDED: 'a',
      });
      expect(vm.restart).toHaveBeenCalled();
      expect(docker.createContainer).not.toHaveBeenCalled();
    });

    it('keeps the launcher configuration and guest-root mounts when a microVM worker is recreated (guard join)', async () => {
      const vm = containerDouble('vm-re', MICROVM_LABELS);
      const hostConfig = {
        Runtime: 'runc',
        Devices: [{ PathOnHost: '/dev/kvm', PathInContainer: '/dev/kvm', CgroupPermissions: 'rwm' }],
        CapDrop: ['ALL'],
        CapAdd: ['CHOWN'],
        SecurityOpt: ['no-new-privileges'],
        Mounts: [{ Type: 'volume', Source: 'agenstra-env-2', Target: '/guest/etc/agenstra/environment' }],
      };

      vm.inspect.mockResolvedValue({
        Id: 'vm-re',
        Name: '/vm-re',
        State: { Running: true },
        Config: { Image: 'worker-microvm', Env: [], Labels: MICROVM_LABELS },
        HostConfig: hostConfig,
        NetworkSettings: { Networks: {} },
        Mounts: [
          { Type: 'volume', Name: 'agenstra-env-2', Destination: '/guest/etc/agenstra/environment', RW: true },
          { Type: 'bind', Source: '/opt/agents/1', Destination: '/guest/app', RW: true },
          { Type: 'bind', Source: '/opt/agents', Destination: '/guest/opt/workspace', RW: false },
        ],
      });
      containers.set('vm-re', vm);

      await service.updateContainer('vm-re', {
        sharedNetworkContainerId: 'guard-9',
        capDrop: ['NET_ADMIN'],
        runtime: 'runc',
      });

      const options = docker.createContainer.mock.calls[0][0];

      expect(options.HostConfig).toEqual(
        expect.objectContaining({
          Runtime: 'runc',
          NetworkMode: 'container:guard-9',
          Devices: hostConfig.Devices,
          CapAdd: ['CHOWN'],
          SecurityOpt: ['no-new-privileges'],
          Binds: ['/opt/agents/1:/guest/app', '/opt/agents:/guest/opt/workspace:ro'],
        }),
      );
      expect(options.HostConfig.CapDrop).toEqual(['ALL', 'NET_ADMIN']);
      expect(options.HostConfig.Mounts).toEqual([
        { Type: 'volume', Source: 'agenstra-env-2', Target: '/guest/etc/agenstra/environment', ReadOnly: false },
      ]);
    });
  });

  describe('runMicrovmProbe', () => {
    const probe = { image: 'registry/worker-microvm:test', ownerImage: 'registry/worker:test', timeoutMs: 30_000 };

    it('reports images without the microVM bridge as unsupported without booting anything', async () => {
      imageLabels = {};

      await expect(service.runMicrovmProbe(probe)).resolves.toEqual(
        expect.objectContaining({ ok: false, reasonCode: 'E_MICROVM_IMAGE_UNSUPPORTED' }),
      );
      // Only the /dev/kvm pre-check container ran.
      expect(docker.createContainer).toHaveBeenCalledTimes(1);
      expect(docker.createContainer.mock.calls[0][0].Cmd).toEqual(['test -c /dev/kvm']);
    });

    it('checks /dev/kvm with the probe image before pulling the microVM image', async () => {
      const ensure = jest.spyOn(service, 'ensureImageExists');

      docker.createContainer.mockImplementationOnce(async () => {
        throw new Error(
          'error gathering device information while adding custom device "/dev/kvm": no such file or directory',
        );
      });

      await expect(service.runMicrovmProbe(probe)).resolves.toEqual(
        expect.objectContaining({ ok: false, reasonCode: 'E_KVM_UNAVAILABLE' }),
      );
      expect(ensure).toHaveBeenCalledWith(probe.ownerImage);
      expect(ensure).not.toHaveBeenCalledWith(probe.image);
    });

    it('reports hosts without /dev/kvm distinctly and cleans up', async () => {
      docker.createContainer.mockImplementation(async (options: { name: string }) => {
        if (options.name.endsWith('-microvm')) {
          throw new Error(
            'error gathering device information while adding custom device "/dev/kvm": no such file or directory',
          );
        }

        const container = containerDouble(options.name);

        containers.set(options.name, container);

        return container;
      });

      await expect(service.runMicrovmProbe(probe)).resolves.toEqual(
        expect.objectContaining({ ok: false, reasonCode: 'E_KVM_UNAVAILABLE' }),
      );
      expect([...containers.values()].every((container) => container.remove.mock.calls.length > 0)).toBe(true);
    });

    it('reports a microVM that never booted with the launcher reason', async () => {
      docker.createContainer.mockImplementation(async (options: { name: string }) => {
        const container = containerDouble(options.name, options.name.endsWith('-microvm') ? MICROVM_LABELS : {});

        if (options.name.endsWith('-microvm')) {
          container.exec.mockImplementation(async () =>
            execDouble('vm-exec: the microVM did not become ready in time', 125),
          );
          container.logs.mockResolvedValue(
            Buffer.from('agenstra-microvm: E_KVM_UNAVAILABLE: /dev/kvm is not accessible\n'),
          );
        }

        containers.set(options.name, container);

        return container;
      });

      await expect(service.runMicrovmProbe(probe)).resolves.toEqual(
        expect.objectContaining({ ok: false, reasonCode: 'E_KVM_UNAVAILABLE' }),
      );
    });

    it('boots one probe microVM in the owner namespace and checks the worker contract inside the guest', async () => {
      docker.createContainer.mockImplementation(async (options: { name: string }) => {
        const microvm = options.name.endsWith('-microvm');
        const container = containerDouble(options.name, microvm ? MICROVM_LABELS : {});

        container.exec.mockImplementation(async (exec: { Cmd: string[]; User?: string }) => {
          const script = exec.Cmd[exec.Cmd.length - 1];

          if (script === 'exit 7') {
            return execDouble('', 7);
          }

          if (script === 'id -u') {
            return execDouble('65534\r\n');
          }

          if (script.includes('urllib.request')) {
            return execDouble('agenstra-netns-ok\n');
          }

          return execDouble('');
        });
        container.getArchive.mockImplementation(async () =>
          Readable.from([buildSingleFileTar('coherence.txt', Buffer.from('agenstra-coherent'))]),
        );
        containers.set(options.name, container);

        return container;
      });

      await expect(service.runMicrovmProbe(probe)).resolves.toEqual({ ok: true });

      const vmOptions = docker.createContainer.mock.calls.find(([options]) => options.name.endsWith('-microvm'))![0];
      const ownerName = docker.createContainer.mock.calls.find(([options]) => options.name.endsWith('-netns-owner'))![0]
        .name;
      const vm = containers.get(vmOptions.name)!;

      expect(vmOptions.HostConfig).toEqual(
        expect.objectContaining({
          NetworkMode: `container:${ownerName}`,
          Runtime: 'runc',
          CapDrop: ['ALL'],
          Devices: [expect.objectContaining({ PathOnHost: '/dev/kvm' })],
        }),
      );
      expect(vmOptions.Env).toEqual(expect.arrayContaining(['AGENSTRA_MICROVM_LOOPBACK_PORTS=18765']));
      // Every probe command runs inside the guest (vm-exec), including the non-root check.
      expect(
        vm.exec.mock.calls.every(([exec]: [{ Cmd: string[] }]) => exec.Cmd[0] === '/usr/lib/agenstra-microvm/vm-exec'),
      ).toBe(true);
      expect(vm.exec.mock.calls.some(([exec]: [{ Cmd: string[] }]) => exec.Cmd.includes('65534'))).toBe(true);
      expect(vm.getArchive).toHaveBeenCalledWith({ path: '/guest/probe/coherence.txt' });
      expect(vm.remove).toHaveBeenCalled();
      expect(containers.get(ownerName)!.remove).toHaveBeenCalled();
    });
  });
});
