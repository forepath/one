import { PassThrough } from 'stream';

import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import Docker = require('dockerode');

import { DockerService } from './docker.service';

// Mock dockerode
jest.mock('dockerode');

describe('DockerService', () => {
  let service: DockerService;
  let mockDocker: jest.Mocked<Docker>;
  let mockContainer: {
    inspect: jest.Mock;
    logs: jest.Mock;
    exec: jest.Mock;
    stop: jest.Mock;
    remove: jest.Mock;
    stats: jest.Mock;
    update: jest.Mock;
    restart: jest.Mock;
    start: jest.Mock;
    modem: {
      demuxStream: jest.Mock;
    };
  };
  let mockExec: {
    start: jest.Mock;
  };
  let mockStream: NodeJS.ReadWriteStream;
  let mockNetwork: {
    inspect: jest.Mock;
    connect: jest.Mock;
    disconnect: jest.Mock;
    remove: jest.Mock;
    id: string;
  };
  let mockImage: {
    inspect: jest.Mock;
  };

  beforeEach(async () => {
    // Create mock stream
    mockStream = {
      write: jest.fn(),
      end: jest.fn(),
      on: jest.fn((event: string, callback: () => void) => {
        // Simulate stream end after a short delay for testing
        if (event === 'end') {
          setTimeout(() => callback(), 10);
        }

        return mockStream;
      }),
      once: jest.fn(),
      removeListener: jest.fn(),
      removeAllListeners: jest.fn(),
      setMaxListeners: jest.fn(),
      getMaxListeners: jest.fn(),
      listeners: jest.fn(),
      rawListeners: jest.fn(),
      emit: jest.fn(),
      listenerCount: jest.fn(),
      prependListener: jest.fn(),
      prependOnceListener: jest.fn(),
      eventNames: jest.fn(),
      pipe: jest.fn(),
      unpipe: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      isPaused: jest.fn(),
      unshift: jest.fn(),
      read: jest.fn(),
      setEncoding: jest.fn(),
      destroy: jest.fn(),
      [Symbol.asyncIterator]: jest.fn(),
    } as any;

    // Create mock exec
    mockExec = {
      start: jest.fn().mockResolvedValue(mockStream),
    };

    // Create mock container
    mockContainer = {
      inspect: jest.fn(),
      logs: jest.fn(),
      exec: jest.fn().mockResolvedValue(mockExec),
      stop: jest.fn(),
      remove: jest.fn(),
      stats: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      restart: jest.fn().mockResolvedValue(undefined),
      start: jest.fn().mockResolvedValue(undefined),
      modem: {
        demuxStream: jest.fn(),
      },
    };

    // Create mock network
    mockNetwork = {
      inspect: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      remove: jest.fn(),
      id: 'test-network-id',
    };

    mockImage = {
      inspect: jest.fn().mockResolvedValue({ Id: 'image-id' }),
    };

    // Create mock Docker instance
    mockDocker = {
      getContainer: jest.fn().mockReturnValue(mockContainer),
      getImage: jest.fn().mockReturnValue(mockImage),
      getNetwork: jest.fn().mockReturnValue(mockNetwork),
      createNetwork: jest.fn().mockResolvedValue(mockNetwork),
      pull: jest.fn().mockResolvedValue(undefined),
    } as any;

    // Mock Docker constructor
    (Docker as jest.MockedClass<typeof Docker>).mockImplementation(() => mockDocker);

    const module: TestingModule = await Test.createTestingModule({
      providers: [DockerService],
    }).compile();

    service = module.get<DockerService>(DockerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createContainer', () => {
    let createdContainer: { start: jest.Mock; id: string };

    beforeEach(() => {
      createdContainer = { start: jest.fn().mockResolvedValue(undefined), id: 'abc123' } as any;
      (mockDocker as any).createContainer = jest.fn().mockResolvedValue(createdContainer);
      (mockDocker as any).pull = jest.fn((image: string, cb: (err: unknown, stream: any) => void) => {
        // Simulate immediate success
        const fakeStream = {} as any;

        cb(null, fakeStream);
        // Simulate followProgress callback
        (mockDocker as any).modem = {
          followProgress: (_s: any, done: (err?: unknown) => void) => done(),
        } as any;
      });
    });

    it('should pull image, create and start container with binds and ports', async () => {
      const result = await service.createContainer({
        image: 'node:22-alpine',
        env: { FOO: 'bar' },
        volumes: [
          { hostPath: '/host/a', containerPath: '/cnt/a' },
          { hostPath: '/host/b', containerPath: '/cnt/b', readOnly: true },
        ],
        ports: [
          { containerPort: 3000, hostPort: 3001 },
          { containerPort: 9229, protocol: 'tcp' },
        ],
        network: 'test-network',
      });

      expect((mockDocker as any).pull).toHaveBeenCalledWith('node:22-alpine', expect.any(Function));
      expect((mockDocker as any).createContainer).toHaveBeenCalledWith({
        Image: 'node:22-alpine',
        Env: ['FOO=bar'],
        ExposedPorts: {
          '3000/tcp': {},
          '9229/tcp': {},
        },
        HostConfig: {
          Binds: ['/host/a:/cnt/a', '/host/b:/cnt/b:ro'],
          PortBindings: {
            '3000/tcp': [{ HostPort: '3001' }],
            '9229/tcp': [{ HostPort: undefined }],
          },
          AutoRemove: false,
          RestartPolicy: {
            Name: 'unless-stopped',
          },
          NetworkMode: 'test-network',
        },
      });
      expect(createdContainer.start).toHaveBeenCalled();
      expect(result).toBe('abc123');
    });

    it('should use env default image when image not provided', async () => {
      (mockDocker as any).createContainer = jest.fn().mockResolvedValue(createdContainer);
      const original = process.env.AGENT_DEFAULT_IMAGE;

      process.env.AGENT_DEFAULT_IMAGE = 'env/image:latest';

      try {
        const result = await service.createContainer({ volumes: [], ports: [] });

        expect((mockDocker as any).pull).toHaveBeenCalledWith('env/image:latest', expect.any(Function));
        expect(result).toBe('abc123');
      } finally {
        process.env.AGENT_DEFAULT_IMAGE = original;
      }
    });

    it('should proceed if pulling image fails (image exists locally)', async () => {
      (mockDocker as any).pull = jest.fn((_image: string, cb: (err: unknown, stream?: any) => void) => {
        cb(new Error('pull failed'));
      });
      (mockDocker as any).createContainer = jest.fn().mockResolvedValue(createdContainer);

      const result = await service.createContainer({ image: 'local/image:tag' });

      expect((mockDocker as any).createContainer).toHaveBeenCalled();
      expect(result).toBe('abc123');
    });

    it('should call ensureImageExists before creating container', async () => {
      const ensureSpy = jest.spyOn(service, 'ensureImageExists').mockResolvedValue(undefined);

      await service.createContainer({ image: 'node:22-alpine' });

      expect(ensureSpy).toHaveBeenCalledWith('node:22-alpine');
      ensureSpy.mockRestore();
    });

    it('should quote env values that contain whitespace', async () => {
      await service.createContainer({
        image: 'node:22-alpine',
        env: { FOO: 'hello world' },
      });

      expect((mockDocker as any).createContainer).toHaveBeenCalledWith(
        expect.objectContaining({ Env: ['FOO="hello world"'] }),
      );
    });

    it('should escape inner quotes and wrap in double quotes', async () => {
      await service.createContainer({
        image: 'node:22-alpine',
        env: { FOO: 'he said "hi"' },
      });

      expect((mockDocker as any).createContainer).toHaveBeenCalledWith(
        expect.objectContaining({ Env: ['FOO="he said \\"hi\\""'] }),
      );
    });

    it('should escape backslashes, newlines, carriage returns and tabs', async () => {
      await service.createContainer({
        image: 'node:22-alpine',
        env: { PATHS: 'C:\\tools\nline2\rline3\tend' },
      });

      // Expected: backslashes doubled, \n, \r, \t visible; no quoting needed (no spaces/quotes)
      expect((mockDocker as any).createContainer).toHaveBeenCalledWith(
        expect.objectContaining({ Env: ['PATHS=C:\\\\tools\\nline2\\rline3\\tend'] }),
      );
    });

    it('should set empty string when env value is undefined', async () => {
      await service.createContainer({ image: 'node:22-alpine', env: { EMPTY: undefined } });
      expect((mockDocker as any).createContainer).toHaveBeenCalledWith(expect.objectContaining({ Env: ['EMPTY='] }));
    });
  });

  describe('updateContainer', () => {
    const containerId = 'test-container-id';
    const newContainerId = 'new-container-id';
    let newContainer: { id: string; start: jest.Mock };

    beforeEach(() => {
      newContainer = {
        id: newContainerId,
        start: jest.fn().mockResolvedValue(undefined),
      };

      // Default mock setup: container exists with minimal config
      mockContainer.inspect.mockResolvedValue({
        Id: containerId,
        Name: '/test-container',
        Image: 'test-image:latest',
        Config: {
          Image: 'test-image:latest',
          Env: [],
          ExposedPorts: {},
          Labels: {},
        },
        HostConfig: {
          AutoRemove: false,
          RestartPolicy: { Name: 'unless-stopped' },
        },
        NetworkSettings: {
          Networks: {},
        },
        Mounts: [],
      });

      mockContainer.stop.mockResolvedValue(undefined);
      mockContainer.remove.mockResolvedValue(undefined);
      (mockDocker as any).createContainer = jest.fn().mockResolvedValue(newContainer);
    });

    it('should recreate container with updated env variables and return new container ID', async () => {
      const ensureSpy = jest.spyOn(service, 'ensureImageExists').mockResolvedValue(undefined);
      const result = await service.updateContainer(containerId, {
        env: { FOO: 'bar', BAZ: 'qux' },
      });

      expect(ensureSpy).toHaveBeenCalledWith('test-image:latest');
      ensureSpy.mockRestore();
      expect(result).toBe(newContainerId);
      expect(mockDocker.getContainer).toHaveBeenCalledWith(containerId);
      expect(mockContainer.inspect).toHaveBeenCalled();
      expect(mockContainer.stop).toHaveBeenCalled();
      expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
      expect((mockDocker as any).createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-container',
          Image: 'test-image:latest',
          Env: ['FOO=bar', 'BAZ=qux'],
        }),
      );
      expect(newContainer.start).toHaveBeenCalled();
    });

    it('should throw NotFoundException when container does not exist', async () => {
      mockContainer.inspect.mockRejectedValue({ statusCode: 404 });

      await expect(service.updateContainer(containerId, { env: { FOO: 'bar' } })).rejects.toThrow(NotFoundException);
      expect(mockContainer.stop).not.toHaveBeenCalled();
      expect(mockContainer.remove).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when container removal fails with 404', async () => {
      mockContainer.remove.mockRejectedValue({ statusCode: 404 });

      await expect(service.updateContainer(containerId, { env: { FOO: 'bar' } })).rejects.toThrow(NotFoundException);
    });

    it('should merge new env variables with existing ones', async () => {
      mockContainer.inspect.mockResolvedValue({
        Id: containerId,
        Name: '/test-container',
        Image: 'test-image:latest',
        Config: {
          Image: 'test-image:latest',
          Env: ['EXISTING=value', 'OTHER=other'],
          ExposedPorts: {},
          Labels: {},
        },
        HostConfig: {
          AutoRemove: false,
        },
        NetworkSettings: {
          Networks: {},
        },
        Mounts: [],
      });

      await service.updateContainer(containerId, {
        env: { FOO: 'bar', EXISTING: 'newvalue' },
      });

      expect((mockDocker as any).createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Env: expect.arrayContaining(['EXISTING=newvalue', 'OTHER=other', 'FOO=bar']),
        }),
      );
    });

    it('should quote env values that contain whitespace', async () => {
      await service.updateContainer(containerId, {
        env: { FOO: 'hello world' },
      });

      expect((mockDocker as any).createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Env: ['FOO="hello world"'],
        }),
      );
    });

    it('should escape inner quotes and wrap in double quotes', async () => {
      await service.updateContainer(containerId, {
        env: { FOO: 'he said "hi"' },
      });

      expect((mockDocker as any).createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Env: ['FOO="he said \\"hi\\""'],
        }),
      );
    });

    it('should escape backslashes, newlines, carriage returns and tabs', async () => {
      await service.updateContainer(containerId, {
        env: { PATHS: 'C:\\tools\nline2\rline3\tend' },
      });

      expect((mockDocker as any).createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Env: ['PATHS=C:\\\\tools\\nline2\\rline3\\tend'],
        }),
      );
    });

    it('should remove env variable when env value is undefined', async () => {
      await service.updateContainer(containerId, {
        env: { EMPTY: undefined },
      });

      expect((mockDocker as any).createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Env: [],
        }),
      );
    });

    it('should handle empty env object', async () => {
      const result = await service.updateContainer(containerId, {
        env: {},
      });

      expect(result).toBe(newContainerId);
      expect((mockDocker as any).createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Env: [],
        }),
      );
      expect(newContainer.start).toHaveBeenCalled();
    });

    it('should handle undefined env', async () => {
      const result = await service.updateContainer(containerId, {});

      expect(result).toBe(newContainerId);
      expect((mockDocker as any).createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          Env: [],
        }),
      );
      expect(newContainer.start).toHaveBeenCalled();
    });

    it('should preserve container configuration when recreating', async () => {
      mockContainer.inspect.mockResolvedValue({
        Id: containerId,
        Name: '/test-container',
        Image: 'test-image:latest',
        Config: {
          Image: 'test-image:latest',
          Env: ['EXISTING=value'],
          ExposedPorts: { '8080/tcp': {} },
          Labels: { 'com.example.label': 'value' },
        },
        HostConfig: {
          AutoRemove: false,
          RestartPolicy: { Name: 'unless-stopped' },
        },
        NetworkSettings: {
          Networks: {},
        },
        Mounts: [
          {
            Type: 'bind',
            Source: '/host/path',
            Destination: '/container/path',
            RW: true,
          },
        ],
      });

      await service.updateContainer(containerId, {
        env: { FOO: 'bar' },
      });

      expect((mockDocker as any).createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-container',
          Image: 'test-image:latest',
          ExposedPorts: { '8080/tcp': {} },
          Labels: { 'com.example.label': 'value' },
          HostConfig: expect.objectContaining({
            Binds: ['/host/path:/container/path', '/opt/agents:/opt/workspace:ro'],
            AutoRemove: false,
          }),
        }),
      );
    });

    it('should reconnect container to networks', async () => {
      const mockNetwork1 = {
        connect: jest.fn().mockResolvedValue(undefined),
      };
      const mockNetwork2 = {
        connect: jest.fn().mockResolvedValue(undefined),
      };

      mockDocker.getNetwork = jest.fn().mockReturnValueOnce(mockNetwork1).mockReturnValueOnce(mockNetwork2);

      mockContainer.inspect.mockResolvedValue({
        Id: containerId,
        Name: '/test-container',
        Image: 'test-image:latest',
        Config: {
          Image: 'test-image:latest',
          Env: [],
          ExposedPorts: {},
          Labels: {},
        },
        HostConfig: {
          AutoRemove: false,
        },
        NetworkSettings: {
          Networks: {
            network1: { NetworkID: 'net1' },
            network2: { NetworkID: 'net2' },
          },
        },
        Mounts: [],
      });

      await service.updateContainer(containerId, {
        env: { FOO: 'bar' },
      });

      expect(mockDocker.getNetwork).toHaveBeenCalledWith('network1');
      expect(mockDocker.getNetwork).toHaveBeenCalledWith('network2');
      expect(mockNetwork1.connect).toHaveBeenCalledWith({ Container: newContainerId });
      expect(mockNetwork2.connect).toHaveBeenCalledWith({ Container: newContainerId });
    });

    it('should handle network connection errors gracefully', async () => {
      const mockNetwork = {
        connect: jest.fn().mockRejectedValue(new Error('Network not found')),
      };

      mockDocker.getNetwork = jest.fn().mockReturnValue(mockNetwork);

      mockContainer.inspect.mockResolvedValue({
        Id: containerId,
        Name: '/test-container',
        Image: 'test-image:latest',
        Config: {
          Image: 'test-image:latest',
          Env: [],
          ExposedPorts: {},
          Labels: {},
        },
        HostConfig: {
          AutoRemove: false,
        },
        NetworkSettings: {
          Networks: {
            network1: { NetworkID: 'net1' },
          },
        },
        Mounts: [],
      });

      // Should not throw, just log warning
      const result = await service.updateContainer(containerId, {
        env: { FOO: 'bar' },
      });

      expect(result).toBe(newContainerId);
      expect(newContainer.start).toHaveBeenCalled();
    });

    it('should handle stop errors gracefully if container is already stopped', async () => {
      mockContainer.stop.mockRejectedValue({ statusCode: 304 }); // Not Modified

      const result = await service.updateContainer(containerId, {
        env: { FOO: 'bar' },
      });

      expect(result).toBe(newContainerId);
      expect(mockContainer.remove).toHaveBeenCalled();
      expect((mockDocker as any).createContainer).toHaveBeenCalled();
    });

    it('should handle stop errors gracefully if container is not found', async () => {
      mockContainer.stop.mockRejectedValue({ statusCode: 404 });

      const result = await service.updateContainer(containerId, {
        env: { FOO: 'bar' },
      });

      expect(result).toBe(newContainerId);
      expect(mockContainer.remove).toHaveBeenCalled();
    });

    it('should propagate stop errors that are not 304 or 404', async () => {
      const stopError = new Error('Stop failed');

      mockContainer.stop.mockRejectedValue(stopError);

      await expect(service.updateContainer(containerId, { env: { FOO: 'bar' } })).rejects.toThrow('Stop failed');
    });

    it('should handle createContainer errors', async () => {
      const createError = new Error('Create failed');

      (mockDocker as any).createContainer.mockRejectedValue(createError);

      await expect(service.updateContainer(containerId, { env: { FOO: 'bar' } })).rejects.toThrow('Create failed');
    });

    it('should handle start errors', async () => {
      const startError = new Error('Start failed');

      newContainer.start.mockRejectedValue(startError);

      await expect(service.updateContainer(containerId, { env: { FOO: 'bar' } })).rejects.toThrow('Start failed');
    });

    it('should call getContainer with correct containerId', async () => {
      await service.updateContainer(containerId, { env: { FOO: 'bar' } });

      expect(mockDocker.getContainer).toHaveBeenCalledWith(containerId);
    });
  });

  describe('execCommandStream', () => {
    it('should stream demuxed stdout and stderr chunks', async () => {
      const containerId = 'test-container-id';

      mockContainer.inspect.mockResolvedValue({ Id: containerId });

      const hijacked = new PassThrough() as unknown as NodeJS.ReadWriteStream;

      mockExec.start = jest.fn().mockResolvedValue(hijacked);
      mockContainer.exec = jest.fn().mockResolvedValue(mockExec);

      let capturedStdout: PassThrough | null = null;
      let capturedStderr: PassThrough | null = null;

      mockContainer.modem.demuxStream = jest.fn((_stream: unknown, stdout: PassThrough, stderr: PassThrough) => {
        capturedStdout = stdout;
        capturedStderr = stderr;
      });

      const received: Array<{ stream: 'stdout' | 'stderr'; chunk: string }> = [];
      const iter = service.execCommandStream(containerId, 'echo hello', 'input');
      const consume = (async () => {
        for await (const item of iter) {
          received.push(item);
        }
      })();

      // Wait until demuxStream captured streams
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(capturedStdout).not.toBeNull();
      expect(capturedStderr).not.toBeNull();

      capturedStdout?.write(Buffer.from('out-1'));
      capturedStderr?.write(Buffer.from('err-1'));
      capturedStdout?.end();
      capturedStderr?.end();

      await consume;

      expect(received).toEqual(
        expect.arrayContaining([
          { stream: 'stdout', chunk: 'out-1' },
          { stream: 'stderr', chunk: 'err-1' },
        ]),
      );
      expect(mockContainer.exec).toHaveBeenCalled();
      expect(mockContainer.modem.demuxStream).toHaveBeenCalled();
    });

    it('should throw NotFoundException when container does not exist', async () => {
      mockContainer.inspect.mockRejectedValue({ statusCode: 404 });

      const iter = service.execCommandStream('missing', 'echo hello');

      await expect(
        (async () => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          for await (const _item of iter) {
            // no-op
          }
        })(),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteContainer', () => {
    const containerId = 'test-container-id';

    it('should throw NotFoundException when container does not exist', async () => {
      mockContainer.inspect.mockRejectedValue({ statusCode: 404 });

      await expect(service.deleteContainer(containerId)).rejects.toThrow(NotFoundException);
      expect(mockContainer.inspect).toHaveBeenCalled();
      expect(mockContainer.stop).not.toHaveBeenCalled();
      expect(mockContainer.remove).not.toHaveBeenCalled();
    });

    it('should stop and remove a running container', async () => {
      mockContainer.inspect.mockResolvedValue({
        State: { Running: true },
      });
      mockContainer.stop.mockResolvedValue(undefined);
      mockContainer.remove.mockResolvedValue(undefined);

      await service.deleteContainer(containerId);

      expect(mockContainer.inspect).toHaveBeenCalled();
      expect(mockContainer.stop).toHaveBeenCalled();
      expect(mockContainer.remove).toHaveBeenCalled();
    });

    it('should remove a stopped container without stopping', async () => {
      mockContainer.inspect.mockResolvedValue({
        State: { Running: false },
      });
      mockContainer.remove.mockResolvedValue(undefined);

      await service.deleteContainer(containerId);

      expect(mockContainer.inspect).toHaveBeenCalled();
      expect(mockContainer.stop).not.toHaveBeenCalled();
      expect(mockContainer.remove).toHaveBeenCalled();
    });

    it('should handle container with undefined state', async () => {
      mockContainer.inspect.mockResolvedValue({
        State: undefined,
      });
      mockContainer.remove.mockResolvedValue(undefined);

      await service.deleteContainer(containerId);

      expect(mockContainer.inspect).toHaveBeenCalled();
      expect(mockContainer.stop).not.toHaveBeenCalled();
      expect(mockContainer.remove).toHaveBeenCalled();
    });

    it('should continue with removal if stop fails with non-409 error', async () => {
      mockContainer.inspect.mockResolvedValue({
        State: { Running: true },
      });
      const stopError = new Error('Stop failed') as any;

      stopError.statusCode = 500;
      mockContainer.stop.mockRejectedValue(stopError);
      mockContainer.remove.mockResolvedValue(undefined);

      await service.deleteContainer(containerId);

      expect(mockContainer.stop).toHaveBeenCalled();
      expect(mockContainer.remove).toHaveBeenCalled();
    });

    it('should ignore 409 error when stopping (container already stopped)', async () => {
      mockContainer.inspect.mockResolvedValue({
        State: { Running: true },
      });
      const stopError = new Error('Container already stopped') as any;

      stopError.statusCode = 409;
      mockContainer.stop.mockRejectedValue(stopError);
      mockContainer.remove.mockResolvedValue(undefined);

      await service.deleteContainer(containerId);

      expect(mockContainer.stop).toHaveBeenCalled();
      expect(mockContainer.remove).toHaveBeenCalled();
    });

    it('should handle container already removed (404 on remove)', async () => {
      mockContainer.inspect.mockResolvedValue({
        State: { Running: false },
      });
      const removeError = new Error('Container not found') as any;

      removeError.statusCode = 404;
      mockContainer.remove.mockRejectedValue(removeError);

      await expect(service.deleteContainer(containerId)).resolves.not.toThrow();
      expect(mockContainer.remove).toHaveBeenCalled();
    });

    it('should force remove container if still running (409 on remove)', async () => {
      mockContainer.inspect.mockResolvedValue({
        State: { Running: true },
      });
      mockContainer.stop.mockResolvedValue(undefined);
      const removeError = new Error('Container is running') as any;

      removeError.statusCode = 409;
      mockContainer.remove.mockRejectedValueOnce(removeError).mockResolvedValueOnce(undefined);

      await service.deleteContainer(containerId);

      expect(mockContainer.remove).toHaveBeenCalledTimes(2);
      expect(mockContainer.remove).toHaveBeenNthCalledWith(1);
      expect(mockContainer.remove).toHaveBeenNthCalledWith(2, { force: true });
    });

    it('should throw error if force remove fails', async () => {
      mockContainer.inspect.mockResolvedValue({
        State: { Running: true },
      });
      mockContainer.stop.mockResolvedValue(undefined);
      const removeError = new Error('Container is running') as any;

      removeError.statusCode = 409;
      const forceError = new Error('Force remove failed') as any;

      mockContainer.remove.mockRejectedValueOnce(removeError).mockRejectedValueOnce(forceError);

      await expect(service.deleteContainer(containerId)).rejects.toThrow('Force remove failed');
      expect(mockContainer.remove).toHaveBeenCalledTimes(2);
    });

    it('should throw error on other remove errors', async () => {
      mockContainer.inspect.mockResolvedValue({
        State: { Running: false },
      });
      const removeError = new Error('Remove failed') as any;

      removeError.statusCode = 500;
      mockContainer.remove.mockRejectedValue(removeError);

      await expect(service.deleteContainer(containerId)).rejects.toThrow('Remove failed');
    });

    it('should handle container inspection errors other than 404', async () => {
      const error = new Error('Docker daemon error') as any;

      error.statusCode = 500;
      mockContainer.inspect.mockRejectedValue(error);

      await expect(service.deleteContainer(containerId)).rejects.toThrow('Docker daemon error');
      expect(mockContainer.stop).not.toHaveBeenCalled();
      expect(mockContainer.remove).not.toHaveBeenCalled();
    });

    it('should call getContainer with correct containerId', async () => {
      mockContainer.inspect.mockResolvedValue({
        State: { Running: false },
      });
      mockContainer.remove.mockResolvedValue(undefined);

      await service.deleteContainer(containerId);

      expect(mockDocker.getContainer).toHaveBeenCalledWith(containerId);
    });
  });

  describe('createNetwork', () => {
    const networkName = 'test-network';

    it('should create a network with default driver', async () => {
      const result = await service.createNetwork({ name: networkName });

      expect((mockDocker as any).createNetwork).toHaveBeenCalledWith({
        Name: networkName,
        Driver: 'bridge',
      });
      expect(result).toBe('test-network-id');
    });

    it('should create a network with custom driver', async () => {
      const result = await service.createNetwork({ name: networkName, driver: 'overlay' });

      expect((mockDocker as any).createNetwork).toHaveBeenCalledWith({
        Name: networkName,
        Driver: 'overlay',
      });
      expect(result).toBe('test-network-id');
    });

    it('should create a network and attach containers', async () => {
      const containerIds = ['container-1', 'container-2'];

      mockNetwork.connect.mockResolvedValue(undefined);

      const result = await service.createNetwork({ name: networkName, containerIds });

      expect((mockDocker as any).createNetwork).toHaveBeenCalledWith({
        Name: networkName,
        Driver: 'bridge',
      });
      expect(mockNetwork.connect).toHaveBeenCalledTimes(2);
      expect(mockNetwork.connect).toHaveBeenNthCalledWith(1, { Container: 'container-1' });
      expect(mockNetwork.connect).toHaveBeenNthCalledWith(2, { Container: 'container-2' });
      expect(result).toBe('test-network-id');
    });

    it('should continue attaching containers if one fails', async () => {
      const containerIds = ['container-1', 'container-2', 'container-3'];
      const connectError = new Error('Connection failed') as any;

      connectError.statusCode = 500;
      mockNetwork.connect
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(connectError)
        .mockResolvedValueOnce(undefined);

      const result = await service.createNetwork({ name: networkName, containerIds });

      expect(mockNetwork.connect).toHaveBeenCalledTimes(3);
      expect(result).toBe('test-network-id');
    });

    it('should create network without containers when containerIds is empty', async () => {
      const result = await service.createNetwork({ name: networkName, containerIds: [] });

      expect((mockDocker as any).createNetwork).toHaveBeenCalled();
      expect(mockNetwork.connect).not.toHaveBeenCalled();
      expect(result).toBe('test-network-id');
    });

    it('should create network without containers when containerIds is undefined', async () => {
      const result = await service.createNetwork({ name: networkName });

      expect((mockDocker as any).createNetwork).toHaveBeenCalled();
      expect(mockNetwork.connect).not.toHaveBeenCalled();
      expect(result).toBe('test-network-id');
    });

    it('should handle network creation errors', async () => {
      const createError = new Error('Network creation failed');

      (mockDocker as any).createNetwork.mockRejectedValue(createError);

      await expect(service.createNetwork({ name: networkName })).rejects.toThrow('Network creation failed');
    });
  });

  describe('deleteNetwork', () => {
    const networkId = 'test-network-id';

    it('should throw NotFoundException when network does not exist', async () => {
      mockNetwork.inspect.mockRejectedValue({ statusCode: 404 });

      await expect(service.deleteNetwork(networkId)).rejects.toThrow(NotFoundException);
      expect(mockNetwork.inspect).toHaveBeenCalled();
      expect(mockNetwork.disconnect).not.toHaveBeenCalled();
      expect(mockNetwork.remove).not.toHaveBeenCalled();
    });

    it('should delete a network without containers', async () => {
      mockNetwork.inspect.mockResolvedValue({
        Containers: {},
      });
      mockNetwork.remove.mockResolvedValue(undefined);

      await service.deleteNetwork(networkId);

      expect(mockNetwork.inspect).toHaveBeenCalled();
      expect(mockNetwork.disconnect).not.toHaveBeenCalled();
      expect(mockNetwork.remove).toHaveBeenCalled();
      expect(mockDocker.getNetwork).toHaveBeenCalledWith(networkId);
    });

    it('should disconnect containers before deleting network', async () => {
      mockNetwork.inspect.mockResolvedValue({
        Containers: {
          'container-1': {
            Name: 'container-1',
            EndpointID: 'endpoint-1',
            MacAddress: '00:00:00:00:00:01',
            IPv4Address: '172.17.0.2/16',
            IPv6Address: '',
          },
          'container-2': {
            Name: 'container-2',
            EndpointID: 'endpoint-2',
            MacAddress: '00:00:00:00:00:02',
            IPv4Address: '172.17.0.3/16',
            IPv6Address: '',
          },
        },
      });
      mockNetwork.disconnect.mockResolvedValue(undefined);
      mockNetwork.remove.mockResolvedValue(undefined);

      await service.deleteNetwork(networkId);

      expect(mockNetwork.inspect).toHaveBeenCalled();
      expect(mockNetwork.disconnect).toHaveBeenCalledTimes(2);
      expect(mockNetwork.disconnect).toHaveBeenNthCalledWith(1, { Container: 'container-1' });
      expect(mockNetwork.disconnect).toHaveBeenNthCalledWith(2, { Container: 'container-2' });
      expect(mockNetwork.remove).toHaveBeenCalled();
    });

    it('should handle network with undefined Containers', async () => {
      mockNetwork.inspect.mockResolvedValue({
        Containers: undefined,
      });
      mockNetwork.remove.mockResolvedValue(undefined);

      await service.deleteNetwork(networkId);

      expect(mockNetwork.inspect).toHaveBeenCalled();
      expect(mockNetwork.disconnect).not.toHaveBeenCalled();
      expect(mockNetwork.remove).toHaveBeenCalled();
    });

    it('should continue disconnecting if one container disconnect fails', async () => {
      mockNetwork.inspect.mockResolvedValue({
        Containers: {
          'container-1': {
            Name: 'container-1',
            EndpointID: 'endpoint-1',
            MacAddress: '00:00:00:00:00:01',
            IPv4Address: '172.17.0.2/16',
            IPv6Address: '',
          },
          'container-2': {
            Name: 'container-2',
            EndpointID: 'endpoint-2',
            MacAddress: '00:00:00:00:00:02',
            IPv4Address: '172.17.0.3/16',
            IPv6Address: '',
          },
        },
      });
      const disconnectError = new Error('Disconnect failed') as any;

      disconnectError.statusCode = 500;
      mockNetwork.disconnect.mockResolvedValueOnce(undefined).mockRejectedValueOnce(disconnectError);
      mockNetwork.remove.mockResolvedValue(undefined);

      await service.deleteNetwork(networkId);

      expect(mockNetwork.disconnect).toHaveBeenCalledTimes(2);
      expect(mockNetwork.remove).toHaveBeenCalled();
    });

    it('should ignore 404 errors when disconnecting containers', async () => {
      mockNetwork.inspect.mockResolvedValue({
        Containers: {
          'container-1': {
            Name: 'container-1',
            EndpointID: 'endpoint-1',
            MacAddress: '00:00:00:00:00:01',
            IPv4Address: '172.17.0.2/16',
            IPv6Address: '',
          },
        },
      });
      const disconnectError = new Error('Container not found') as any;

      disconnectError.statusCode = 404;
      mockNetwork.disconnect.mockRejectedValue(disconnectError);
      mockNetwork.remove.mockResolvedValue(undefined);

      await service.deleteNetwork(networkId);

      expect(mockNetwork.disconnect).toHaveBeenCalled();
      expect(mockNetwork.remove).toHaveBeenCalled();
    });

    it('should handle network already removed (404 on remove)', async () => {
      mockNetwork.inspect.mockResolvedValue({
        Containers: {},
      });
      const removeError = new Error('Network not found') as any;

      removeError.statusCode = 404;
      mockNetwork.remove.mockRejectedValue(removeError);

      await expect(service.deleteNetwork(networkId)).resolves.not.toThrow();
      expect(mockNetwork.remove).toHaveBeenCalled();
    });

    it('should throw error on other remove errors', async () => {
      mockNetwork.inspect.mockResolvedValue({
        Containers: {},
      });
      const removeError = new Error('Remove failed') as any;

      removeError.statusCode = 500;
      mockNetwork.remove.mockRejectedValue(removeError);

      await expect(service.deleteNetwork(networkId)).rejects.toThrow('Remove failed');
    });

    it('should handle network inspection errors other than 404', async () => {
      const error = new Error('Docker daemon error') as any;

      error.statusCode = 500;
      mockNetwork.inspect.mockRejectedValue(error);

      await expect(service.deleteNetwork(networkId)).rejects.toThrow('Docker daemon error');
      expect(mockNetwork.disconnect).not.toHaveBeenCalled();
      expect(mockNetwork.remove).not.toHaveBeenCalled();
    });

    it('should call getNetwork with correct networkId', async () => {
      mockNetwork.inspect.mockResolvedValue({
        Containers: {},
      });
      mockNetwork.remove.mockResolvedValue(undefined);

      await service.deleteNetwork(networkId);

      expect(mockDocker.getNetwork).toHaveBeenCalledWith(networkId);
    });
  });

  describe('getContainerLogs', () => {
    const containerId = 'test-container-id';

    it('should throw NotFoundException when container does not exist', async () => {
      mockContainer.inspect.mockRejectedValue({ statusCode: 404 });

      const logsGenerator = service.getContainerLogs(containerId);

      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of logsGenerator) {
          // Consume the generator to trigger the error
        }
      }).rejects.toThrow(NotFoundException);
      expect(mockContainer.inspect).toHaveBeenCalled();
    });

    it('should yield historical logs first', async () => {
      const historicalLogs = Buffer.from('line1\nline2\nline3\n');

      mockContainer.inspect.mockResolvedValue({});
      mockContainer.logs
        .mockResolvedValueOnce(historicalLogs) // Historical logs
        .mockResolvedValueOnce(Buffer.from('')); // Live logs (empty buffer)

      const logs: string[] = [];

      for await (const line of service.getContainerLogs(containerId)) {
        logs.push(line);
      }

      expect(logs).toEqual(['line1', 'line2', 'line3']);
      expect(mockContainer.logs).toHaveBeenCalledTimes(2);
      expect(mockContainer.logs).toHaveBeenNthCalledWith(1, {
        stdout: true,
        stderr: true,
        tail: 100,
        timestamps: false,
      });
    });

    it('should yield live logs after historical logs', async () => {
      const historicalLogs = Buffer.from('historical1\nhistorical2\n');
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('live1\nlive2\n');
        },
      };

      mockContainer.inspect.mockResolvedValue({});
      mockContainer.logs.mockResolvedValueOnce(historicalLogs).mockReturnValueOnce(mockStream as any);

      const logs: string[] = [];

      for await (const line of service.getContainerLogs(containerId)) {
        logs.push(line);
      }

      expect(logs).toEqual(['historical1', 'historical2', 'live1', 'live2']);
      expect(mockContainer.logs).toHaveBeenNthCalledWith(2, {
        stdout: true,
        stderr: true,
        follow: true,
        tail: 0,
        timestamps: false,
      });
    });

    it('should handle live logs as a stream', async () => {
      const historicalLogs = Buffer.from('historical\n');
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('live1\nlive2\n');
          yield Buffer.from('live3\n');
        },
      };

      mockContainer.inspect.mockResolvedValue({});
      mockContainer.logs.mockResolvedValueOnce(historicalLogs).mockReturnValueOnce(mockStream as any);

      const logs: string[] = [];

      for await (const line of service.getContainerLogs(containerId)) {
        logs.push(line);
      }

      expect(logs).toContain('historical');
      expect(logs).toContain('live1');
      expect(logs).toContain('live2');
      expect(logs).toContain('live3');
    });

    it('should filter out empty lines', async () => {
      const historicalLogs = Buffer.from('line1\n\nline2\n   \nline3\n');
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          // Empty stream
        },
      };

      mockContainer.inspect.mockResolvedValue({});
      mockContainer.logs.mockResolvedValueOnce(historicalLogs).mockReturnValueOnce(mockStream as any);

      const logs: string[] = [];

      for await (const line of service.getContainerLogs(containerId)) {
        logs.push(line);
      }

      expect(logs).toEqual(['line1', 'line2', 'line3']);
    });

    it('should handle incomplete lines in stream chunks', async () => {
      const historicalLogs = Buffer.from('historical\n');
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('line1\nline2');
          yield Buffer.from('_continued\nline3\n');
        },
      };

      mockContainer.inspect.mockResolvedValue({});
      mockContainer.logs.mockResolvedValueOnce(historicalLogs).mockReturnValueOnce(mockStream as any);

      const logs: string[] = [];

      for await (const line of service.getContainerLogs(containerId)) {
        logs.push(line);
      }

      expect(logs).toContain('historical');
      expect(logs).toContain('line1');
      expect(logs).toContain('line2_continued');
      expect(logs).toContain('line3');
    });

    it('should handle stream errors gracefully', async () => {
      const historicalLogs = Buffer.from('historical\n');
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('line1\n');
          const error = new Error('Stream error') as any;

          error.code = 'ECONNRESET';
          throw error;
        },
      };

      mockContainer.inspect.mockResolvedValue({});
      mockContainer.logs.mockResolvedValueOnce(historicalLogs).mockReturnValueOnce(mockStream as any);

      const logs: string[] = [];

      for await (const line of service.getContainerLogs(containerId)) {
        logs.push(line);
      }

      // Should have yielded historical logs and line1 before stream error
      expect(logs).toContain('historical');
      expect(logs).toContain('line1');
    });

    it('should propagate non-connection errors from stream', async () => {
      const historicalLogs = Buffer.from('historical\n');
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('line1\n');
          throw new Error('Critical error');
        },
      };

      mockContainer.inspect.mockResolvedValue({});
      mockContainer.logs.mockResolvedValueOnce(historicalLogs).mockReturnValueOnce(mockStream as any);

      const logsGenerator = service.getContainerLogs(containerId);

      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of logsGenerator) {
          // Consume the generator
        }
      }).rejects.toThrow('Critical error');
    });

    it('should handle container inspection errors', async () => {
      const error = new Error('Docker daemon error') as any;

      error.statusCode = 500;
      mockContainer.inspect.mockRejectedValue(error);

      const logsGenerator = service.getContainerLogs(containerId);

      await expect(async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of logsGenerator) {
          // Consume the generator to trigger the error
        }
      }).rejects.toThrow('Docker daemon error');
    });

    it('should call getContainer with correct containerId', async () => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          // Empty stream
        },
      };

      mockContainer.inspect.mockResolvedValue({});
      mockContainer.logs.mockResolvedValueOnce(Buffer.from('')).mockReturnValueOnce(mockStream as any);

      const logsGenerator = service.getContainerLogs(containerId);

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of logsGenerator) {
        // Consume the generator
      }

      expect(mockDocker.getContainer).toHaveBeenCalledWith(containerId);
    });
  });

  describe('sendCommandToContainer', () => {
    const containerId = 'test-container-id';

    beforeEach(() => {
      // Reset stream mock for each test
      const dataChunks: Buffer[] = [];

      mockStream.on = jest.fn((event: string, callback: (chunk?: Buffer) => void) => {
        if (event === 'data') {
          // Simulate data collection
          const testData = Buffer.from('test output\n');

          dataChunks.push(testData);
          setTimeout(() => callback(testData), 5);
        } else if (event === 'end' || event === 'close') {
          setTimeout(() => callback(), 10);
        }

        return mockStream;
      });
    });

    it('should throw NotFoundException when container does not exist', async () => {
      mockContainer.inspect.mockRejectedValue({ statusCode: 404 });

      await expect(service.sendCommandToContainer(containerId, 'ls')).rejects.toThrow(NotFoundException);
      expect(mockContainer.inspect).toHaveBeenCalled();
    });

    it('should execute a command without input and return output', async () => {
      mockContainer.inspect.mockResolvedValue({});
      const outputData = Buffer.from([1, 0, 0, 0, 12, 116, 101, 115, 116, 32, 111, 117, 116, 112, 117, 116]); // Docker format: stdout + "test output"

      mockStream.on = jest.fn((event: string, callback: (chunk?: Buffer) => void) => {
        if (event === 'data') {
          setTimeout(() => callback(outputData), 5);
        } else if (event === 'end') {
          setTimeout(() => callback(), 10);
        }

        return mockStream;
      });

      const result = await service.sendCommandToContainer(containerId, 'ls');

      expect(mockContainer.exec).toHaveBeenCalledWith({
        Cmd: ['ls'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
      expect(mockExec.start).toHaveBeenCalledWith({
        hijack: true,
        stdin: true,
      });
      expect(mockStream.write).not.toHaveBeenCalled();
      expect(mockStream.end).toHaveBeenCalled();
      expect(result).toBeTruthy();
    });

    it('should execute a command with arguments', async () => {
      mockContainer.inspect.mockResolvedValue({});

      await service.sendCommandToContainer(containerId, 'ls -la /tmp');

      expect(mockContainer.exec).toHaveBeenCalledWith({
        Cmd: ['ls', '-la', '/tmp'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
    });

    it('should send string input as keystrokes', async () => {
      mockContainer.inspect.mockResolvedValue({});

      await service.sendCommandToContainer(containerId, 'bash', 'echo hello');

      expect(mockStream.write).toHaveBeenCalledWith('echo hello\n');
      expect(mockStream.end).toHaveBeenCalled();
    });

    it('should send array of strings as multiple keystrokes', async () => {
      mockContainer.inspect.mockResolvedValue({});

      await service.sendCommandToContainer(containerId, 'bash', ['cd /tmp', 'ls -la']);

      expect(mockStream.write).toHaveBeenCalledWith('cd /tmp\n');
      expect(mockStream.write).toHaveBeenCalledWith('ls -la\n');
      expect(mockStream.write).toHaveBeenCalledTimes(2);
      expect(mockStream.end).toHaveBeenCalled();
    });

    it('should split multi-line string input into separate lines', async () => {
      mockContainer.inspect.mockResolvedValue({});

      await service.sendCommandToContainer(containerId, 'bash', '/plan\n\ntest message');

      expect(mockStream.write).toHaveBeenCalledWith('/plan\n');
      expect(mockStream.write).toHaveBeenCalledWith('\n');
      expect(mockStream.write).toHaveBeenCalledWith('test message\n');
      expect(mockStream.write).toHaveBeenCalledTimes(3);
      expect(mockStream.end).toHaveBeenCalled();
    });

    it('should handle multi-line string with Windows line endings', async () => {
      mockContainer.inspect.mockResolvedValue({});

      await service.sendCommandToContainer(containerId, 'bash', 'line1\r\nline2\r\nline3');

      expect(mockStream.write).toHaveBeenCalledWith('line1\n');
      expect(mockStream.write).toHaveBeenCalledWith('line2\n');
      expect(mockStream.write).toHaveBeenCalledWith('line3\n');
      expect(mockStream.write).toHaveBeenCalledTimes(3);
      expect(mockStream.end).toHaveBeenCalled();
    });

    it('should handle string ending with newline (creates empty last line)', async () => {
      mockContainer.inspect.mockResolvedValue({});

      await service.sendCommandToContainer(containerId, 'bash', 'echo hello\n');

      // When split, 'echo hello\n' becomes ['echo hello', '']
      // Each line gets a newline appended
      expect(mockStream.write).toHaveBeenCalledWith('echo hello\n');
      expect(mockStream.write).toHaveBeenCalledWith('\n');
      expect(mockStream.write).toHaveBeenCalledTimes(2);
      expect(mockStream.end).toHaveBeenCalled();
    });

    it('should convert literal \\n strings to actual newlines and split', async () => {
      mockContainer.inspect.mockResolvedValue({});

      // Test literal \n (backslash + n) that might come over websocket
      await service.sendCommandToContainer(containerId, 'bash', '/plan\\n\\ntest message');

      // Should convert \\n to \n, then split
      expect(mockStream.write).toHaveBeenCalledWith('/plan\n');
      expect(mockStream.write).toHaveBeenCalledWith('\n');
      expect(mockStream.write).toHaveBeenCalledWith('test message\n');
      expect(mockStream.write).toHaveBeenCalledTimes(3);
      expect(mockStream.end).toHaveBeenCalled();
    });

    it('should handle array with literal \\n strings', async () => {
      mockContainer.inspect.mockResolvedValue({});

      // Test array with literal \n strings
      await service.sendCommandToContainer(containerId, 'bash', ['line1\\nmore', 'line2']);

      // Should convert \\n to \n in each array element, then split each element
      expect(mockStream.write).toHaveBeenCalledWith('line1\n');
      expect(mockStream.write).toHaveBeenCalledWith('more\n');
      expect(mockStream.write).toHaveBeenCalledWith('line2\n');
      expect(mockStream.write).toHaveBeenCalledTimes(3);
      expect(mockStream.end).toHaveBeenCalled();
    });

    it('should handle mixed literal \\n and actual newlines', async () => {
      mockContainer.inspect.mockResolvedValue({});

      // Test mix of literal \n and actual newlines
      await service.sendCommandToContainer(containerId, 'bash', '/plan\\n\nactual newline');

      // Should convert \\n to \n, then split by both
      expect(mockStream.write).toHaveBeenCalledWith('/plan\n');
      expect(mockStream.write).toHaveBeenCalledWith('\n');
      expect(mockStream.write).toHaveBeenCalledWith('actual newline\n');
      expect(mockStream.write).toHaveBeenCalledTimes(3);
      expect(mockStream.end).toHaveBeenCalled();
    });

    it('should handle empty input array', async () => {
      mockContainer.inspect.mockResolvedValue({});

      await service.sendCommandToContainer(containerId, 'bash', []);

      expect(mockStream.write).not.toHaveBeenCalled();
      expect(mockStream.end).toHaveBeenCalled();
    });

    it('should handle container inspection errors', async () => {
      const error = new Error('Docker daemon error') as any;

      error.statusCode = 500;
      mockContainer.inspect.mockRejectedValue(error);

      await expect(service.sendCommandToContainer(containerId, 'ls')).rejects.toThrow('Docker daemon error');
    });

    it('should handle exec creation errors', async () => {
      mockContainer.inspect.mockResolvedValue({});
      mockContainer.exec.mockRejectedValue(new Error('Exec creation failed'));

      await expect(service.sendCommandToContainer(containerId, 'ls')).rejects.toThrow('Exec creation failed');
    });

    it('should handle stream start errors', async () => {
      mockContainer.inspect.mockResolvedValue({});
      mockExec.start.mockRejectedValue(new Error('Stream start failed'));

      await expect(service.sendCommandToContainer(containerId, 'ls')).rejects.toThrow('Stream start failed');
    });

    it('should ignore EPIPE errors when closing stream and return output', async () => {
      mockContainer.inspect.mockResolvedValue({});
      const outputData = Buffer.from([1, 0, 0, 0, 11, 116, 101, 115, 116, 32, 111, 117, 116, 112, 117, 116]); // Docker format
      const handlers: { [key: string]: Array<(arg?: unknown) => void> } = {};

      mockStream.on = jest.fn((event: string, callback: (error?: unknown, chunk?: Buffer) => void) => {
        if (!handlers[event]) {
          handlers[event] = [];
        }

        handlers[event].push(callback as (arg?: unknown) => void);

        // Simulate data event immediately if it's the data handler
        if (event === 'data') {
          setTimeout(() => {
            handlers['data']?.forEach((cb) => cb(outputData));
          }, 5);
        }

        // Simulate error event after data
        if (event === 'error') {
          setTimeout(() => {
            const error = new Error('EPIPE') as any;

            error.code = 'EPIPE';
            handlers['error']?.forEach((cb) => cb(error));
          }, 15);
        }

        // Simulate end event
        if (event === 'end') {
          setTimeout(() => {
            handlers['end']?.forEach((cb) => cb());
          }, 20);
        }

        // Simulate close event
        if (event === 'close') {
          setTimeout(() => {
            handlers['close']?.forEach((cb) => cb());
          }, 25);
        }

        return mockStream;
      });

      const result = await service.sendCommandToContainer(containerId, 'ls');

      expect(result).toBeTruthy();
      expect(result).toContain('test output');
    });

    it('should propagate non-EPIPE stream errors', async () => {
      mockContainer.inspect.mockResolvedValue({});
      const streamError = new Error('Stream error') as any;

      streamError.code = 'ECONNREFUSED';
      mockStream.on = jest.fn((event: string, callback: (error?: unknown) => void) => {
        if (event === 'error') {
          setTimeout(() => callback(streamError), 10);
        }

        return mockStream;
      });

      await expect(service.sendCommandToContainer(containerId, 'ls')).rejects.toThrow('Stream error');
    });

    it('should call getContainer with correct containerId', async () => {
      mockContainer.inspect.mockResolvedValue({});

      await service.sendCommandToContainer(containerId, 'ls');

      expect(mockDocker.getContainer).toHaveBeenCalledWith(containerId);
    });

    it('should handle commands with multiple spaces', async () => {
      mockContainer.inspect.mockResolvedValue({});

      await service.sendCommandToContainer(containerId, 'ls    -la   /tmp');

      expect(mockContainer.exec).toHaveBeenCalledWith({
        Cmd: ['ls', '-la', '/tmp'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
    });

    it('should handle commands with leading/trailing whitespace', async () => {
      mockContainer.inspect.mockResolvedValue({});

      await service.sendCommandToContainer(containerId, '  ls -la  ');

      expect(mockContainer.exec).toHaveBeenCalledWith({
        Cmd: ['ls', '-la'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
    });

    it('should handle single-quoted arguments', async () => {
      mockContainer.inspect.mockResolvedValue({});

      await service.sendCommandToContainer(containerId, "git clone 'https://example.com/repo' /app");

      expect(mockContainer.exec).toHaveBeenCalledWith({
        Cmd: ['git', 'clone', 'https://example.com/repo', '/app'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
    });

    it('should handle double-quoted arguments', async () => {
      mockContainer.inspect.mockResolvedValue({});

      await service.sendCommandToContainer(containerId, 'echo "hello world"');

      expect(mockContainer.exec).toHaveBeenCalledWith({
        Cmd: ['echo', 'hello world'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
    });

    it('should handle escaped spaces', async () => {
      mockContainer.inspect.mockResolvedValue({});

      await service.sendCommandToContainer(containerId, 'ls -la /tmp\\ with\\ spaces');

      expect(mockContainer.exec).toHaveBeenCalledWith({
        Cmd: ['ls', '-la', '/tmp with spaces'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
    });

    it('should handle mixed single and double quotes', async () => {
      mockContainer.inspect.mockResolvedValue({});

      await service.sendCommandToContainer(containerId, 'echo \'single\' "double" mixed');

      expect(mockContainer.exec).toHaveBeenCalledWith({
        Cmd: ['echo', 'single', 'double', 'mixed'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
    });

    it('should handle escaped quotes inside double quotes', async () => {
      mockContainer.inspect.mockResolvedValue({});

      await service.sendCommandToContainer(containerId, 'echo "he said \\"hello\\""');

      expect(mockContainer.exec).toHaveBeenCalledWith({
        Cmd: ['echo', 'he said "hello"'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
    });

    it('should handle single quotes with spaces inside', async () => {
      mockContainer.inspect.mockResolvedValue({});

      await service.sendCommandToContainer(containerId, "git commit -m 'my commit message with spaces'");

      expect(mockContainer.exec).toHaveBeenCalledWith({
        Cmd: ['git', 'commit', '-m', 'my commit message with spaces'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
    });

    it('should handle complex command with quotes and escaped characters', async () => {
      mockContainer.inspect.mockResolvedValue({});

      // In single quotes, backslashes are literal, so 'key=value\ with\ spaces' stays as-is
      // For interpreted escapes, use double quotes or no quotes
      await service.sendCommandToContainer(
        containerId,
        'curl -X POST "https://api.example.com" -d "key=value\\ with\\ spaces"',
      );

      expect(mockContainer.exec).toHaveBeenCalledWith({
        Cmd: ['curl', '-X', 'POST', 'https://api.example.com', '-d', 'key=value with spaces'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
    });

    it('should handle the original issue: git clone with single-quoted URL', async () => {
      mockContainer.inspect.mockResolvedValue({});

      await service.sendCommandToContainer(containerId, "git clone 'https://url' /app");

      expect(mockContainer.exec).toHaveBeenCalledWith({
        Cmd: ['git', 'clone', 'https://url', '/app'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
    });

    it('should preserve backslashes literally inside single quotes', async () => {
      mockContainer.inspect.mockResolvedValue({});

      // Single quotes preserve everything literally, including backslashes
      await service.sendCommandToContainer(containerId, "echo 'path\\with\\backslashes'");

      expect(mockContainer.exec).toHaveBeenCalledWith({
        Cmd: ['echo', 'path\\with\\backslashes'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
    });
  });

  describe('readFileFromContainer', () => {
    const containerId = 'test-container-id';
    const filePath = '/app/test-file.txt';

    beforeEach(() => {
      // Reset stream mock for each test
      mockStream.on = jest.fn((event: string, callback: () => void) => {
        if (event === 'end') {
          setTimeout(() => callback(), 10);
        } else if (event === 'close') {
          setTimeout(() => callback(), 15);
        }

        return mockStream;
      });

      // Mock demuxStream to write to PassThrough streams
      mockContainer.modem.demuxStream = jest.fn((stream, stdout, stderr) => {
        // Simulate data being written to stdout
        setTimeout(() => {
          stdout.write(Buffer.from('file content'));
          stdout.end();
          stderr.end();
        }, 5);
      });
    });

    it('should read file content successfully', async () => {
      mockContainer.inspect.mockResolvedValue({});

      const result = await service.readFileFromContainer(containerId, filePath);

      expect(mockContainer.inspect).toHaveBeenCalled();
      expect(mockContainer.exec).toHaveBeenCalledWith({
        Cmd: ['sh', '-c', expect.stringContaining(`cat '${filePath.replace(/'/g, "'\\''")}'`)],
        AttachStdin: false,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
      expect(mockExec.start).toHaveBeenCalledWith({
        hijack: true,
        stdin: false,
      });
      expect(mockContainer.modem.demuxStream).toHaveBeenCalled();
      expect(result).toBe('file content');
    });

    it('should throw NotFoundException when container does not exist', async () => {
      mockContainer.inspect.mockRejectedValue({ statusCode: 404 });

      await expect(service.readFileFromContainer(containerId, filePath)).rejects.toThrow(NotFoundException);
      expect(mockContainer.inspect).toHaveBeenCalled();
    });

    it('should handle file not found error from stderr', async () => {
      mockContainer.inspect.mockResolvedValue({});
      let endCallback: (() => void) | undefined;
      let closeCallback: (() => void) | undefined;

      mockStream.on = jest.fn((event: string, callback: () => void) => {
        if (event === 'end') {
          endCallback = callback;
        } else if (event === 'close') {
          closeCallback = callback;
        }

        return mockStream;
      });
      mockContainer.modem.demuxStream = jest.fn((stream, stdout, stderr) => {
        setTimeout(() => {
          stderr.write(Buffer.from('cat: /app/nonexistent.txt: No such file or directory'));
          stdout.end();
          stderr.end();

          if (endCallback) {
            endCallback();
          }

          if (closeCallback) {
            closeCallback();
          }
        }, 5);
      });

      await expect(service.readFileFromContainer(containerId, '/app/nonexistent.txt')).rejects.toThrow(
        /File not found/,
      );
    });

    it('should handle stderr output that is not an error', async () => {
      mockContainer.inspect.mockResolvedValue({});
      let endCallback: (() => void) | undefined;

      mockStream.on = jest.fn((event: string, callback: () => void) => {
        if (event === 'end') {
          endCallback = callback;
        } else if (event === 'close') {
          setTimeout(() => callback(), 15);
        }

        return mockStream;
      });
      mockContainer.modem.demuxStream = jest.fn((stream, stdout, stderr) => {
        // Small delay to ensure event handlers are set up
        setTimeout(() => {
          // Write data to PassThrough streams (emits 'data' events synchronously)
          stdout.write(Buffer.from('file content'));
          stderr.write(Buffer.from('warning: some warning message'));
          // Use setImmediate to ensure data event handlers have processed before ending streams
          setImmediate(() => {
            // End the PassThrough streams after data has been processed
            stdout.end();
            stderr.end();
            // Trigger stream 'end' event after streams are ended
            setImmediate(() => {
              if (endCallback) {
                endCallback();
              }
            });
          });
        }, 5);
      });

      const result = await service.readFileFromContainer(containerId, filePath);

      // Should still return stdout content even if there's stderr
      expect(result).toBe('file content');
    });

    it('should escape file path with single quotes', async () => {
      mockContainer.inspect.mockResolvedValue({});
      const pathWithQuotes = "/app/file with 'quotes'.txt";

      await service.readFileFromContainer(containerId, pathWithQuotes);

      expect(mockContainer.exec).toHaveBeenCalledWith({
        Cmd: ['sh', '-c', expect.stringContaining("cat '/app/file with '\\''quotes'\\''.txt'")],
        AttachStdin: false,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
    });
  });

  describe('getContainerHomeDirectory', () => {
    const containerId = 'test-container-id';

    beforeEach(() => {
      mockContainer.inspect.mockResolvedValue({});
      mockContainer.modem.demuxStream = jest.fn((stream, stdout) => {
        setTimeout(() => {
          stdout.write(Buffer.from(''));
          stdout.end();
        }, 5);
      });
    });

    it('should return trimmed HOME from container exec output', async () => {
      mockContainer.modem.demuxStream = jest.fn((stream, stdout) => {
        setTimeout(() => {
          stdout.write(Buffer.from('  /custom/home  '));
          stdout.end();
        }, 5);
      });

      const home = await service.getContainerHomeDirectory(containerId);

      expect(home).toBe('/custom/home');
      expect(mockContainer.exec).toHaveBeenCalledWith({
        Cmd: ['sh', '-c', 'printf %s "${HOME:-/home/agenstra}"'],
        AttachStdin: false,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      });
    });

    it('should fall back to /home/agenstra when exec output is empty', async () => {
      mockContainer.modem.demuxStream = jest.fn((stream, stdout) => {
        setTimeout(() => {
          stdout.write(Buffer.from('   '));
          stdout.end();
        }, 5);
      });

      const home = await service.getContainerHomeDirectory(containerId);

      expect(home).toBe('/home/agenstra');
    });

    it('should throw NotFoundException when container does not exist', async () => {
      mockContainer.inspect.mockRejectedValue({ statusCode: 404 });

      await expect(service.getContainerHomeDirectory(containerId)).rejects.toThrow(NotFoundException);
      expect(mockContainer.inspect).toHaveBeenCalled();
    });
  });

  describe('createTerminalSession', () => {
    const containerId = 'test-container-id';
    const sessionId = 'test-session-id';

    beforeEach(() => {
      mockContainer.inspect.mockResolvedValue({});
      mockStream.on = jest.fn((_: string, __: () => void) => {
        return mockStream;
      });
    });

    it('should throw NotFoundException when container does not exist', async () => {
      mockContainer.inspect.mockRejectedValue({ statusCode: 404 });

      await expect(service.createTerminalSession(containerId, sessionId)).rejects.toThrow(NotFoundException);
      expect(mockContainer.inspect).toHaveBeenCalled();
    });

    it('should create a terminal session with TTY enabled', async () => {
      mockContainer.inspect.mockResolvedValue({});

      const stream = await service.createTerminalSession(containerId, sessionId);

      expect(mockContainer.exec).toHaveBeenCalledWith({
        Cmd: ['sh'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
      });
      expect(mockExec.start).toHaveBeenCalledWith({
        hijack: true,
        stdin: true,
        Tty: true,
      });
      expect(stream).toBe(mockStream);
      expect(service.hasTerminalSession(sessionId)).toBe(true);
    });

    it('should create a terminal session with custom shell', async () => {
      mockContainer.inspect.mockResolvedValue({});

      await service.createTerminalSession(containerId, sessionId, 'bash');

      expect(mockContainer.exec).toHaveBeenCalledWith({
        Cmd: ['bash'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
      });
    });

    it('should close existing session if sessionId already exists', async () => {
      mockContainer.inspect.mockResolvedValue({});
      // Create first session
      await service.createTerminalSession(containerId, sessionId);
      // Create second session with same ID
      await service.createTerminalSession(containerId, sessionId);

      expect(mockStream.end).toHaveBeenCalled();
      expect(mockContainer.exec).toHaveBeenCalledTimes(2);
    });

    it('should set up stream event handlers for cleanup', async () => {
      mockContainer.inspect.mockResolvedValue({});
      let endCallback: (() => void) | undefined;
      let closeCallback: (() => void) | undefined;

      mockStream.on = jest.fn((event: string, callback: () => void) => {
        if (event === 'end') {
          endCallback = callback;
        } else if (event === 'close') {
          closeCallback = callback;
        } else if (event === 'error') {
          // error callback
        }

        return mockStream;
      });

      await service.createTerminalSession(containerId, sessionId);

      expect(mockStream.on).toHaveBeenCalledWith('end', expect.any(Function));
      expect(mockStream.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockStream.on).toHaveBeenCalledWith('error', expect.any(Function));

      // Test cleanup on end
      if (endCallback) {
        endCallback();
        expect(service.hasTerminalSession(sessionId)).toBe(false);
      }

      // Recreate for close test
      await service.createTerminalSession(containerId, sessionId);

      if (closeCallback) {
        closeCallback();
        expect(service.hasTerminalSession(sessionId)).toBe(false);
      }
    });
  });

  describe('sendTerminalInput', () => {
    const containerId = 'test-container-id';
    const sessionId = 'test-session-id';

    beforeEach(async () => {
      mockContainer.inspect.mockResolvedValue({});
      mockStream.on = jest.fn(() => mockStream);
      await service.createTerminalSession(containerId, sessionId);
    });

    it('should throw NotFoundException when session does not exist', async () => {
      await expect(service.sendTerminalInput('non-existent', 'data')).rejects.toThrow(NotFoundException);
    });

    it('should send string input to terminal session', async () => {
      await service.sendTerminalInput(sessionId, 'test input');

      expect(mockStream.write).toHaveBeenCalledWith(Buffer.from('test input', 'utf-8'));
    });

    it('should send Buffer input to terminal session', async () => {
      const buffer = Buffer.from('test buffer', 'utf-8');

      await service.sendTerminalInput(sessionId, buffer);

      expect(mockStream.write).toHaveBeenCalledWith(buffer);
    });
  });

  describe('closeTerminalSession', () => {
    const containerId = 'test-container-id';
    const sessionId = 'test-session-id';

    beforeEach(async () => {
      mockContainer.inspect.mockResolvedValue({});
      mockStream.on = jest.fn(() => mockStream);
      await service.createTerminalSession(containerId, sessionId);
    });

    it('should throw NotFoundException when session does not exist', async () => {
      await expect(service.closeTerminalSession('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should close terminal session and remove from map', async () => {
      expect(service.hasTerminalSession(sessionId)).toBe(true);

      await service.closeTerminalSession(sessionId);

      expect(mockStream.end).toHaveBeenCalled();
      expect(service.hasTerminalSession(sessionId)).toBe(false);
    });

    it('should remove session from map even if close fails', async () => {
      (mockStream.end as jest.Mock).mockImplementation(() => {
        throw new Error('Close failed');
      });

      await expect(service.closeTerminalSession(sessionId)).rejects.toThrow('Close failed');
      expect(service.hasTerminalSession(sessionId)).toBe(false);
    });
  });

  describe('getTerminalSession', () => {
    const containerId = 'test-container-id';
    const sessionId = 'test-session-id';

    beforeEach(async () => {
      mockContainer.inspect.mockResolvedValue({});
      mockStream.on = jest.fn(() => mockStream);
      await service.createTerminalSession(containerId, sessionId);
    });

    it('should throw NotFoundException when session does not exist', () => {
      expect(() => service.getTerminalSession('non-existent')).toThrow(NotFoundException);
    });

    it('should return terminal session stream', () => {
      const stream = service.getTerminalSession(sessionId);

      expect(stream).toBe(mockStream);
    });
  });

  describe('hasTerminalSession', () => {
    const containerId = 'test-container-id';
    const sessionId = 'test-session-id';

    it('should return false when session does not exist', () => {
      expect(service.hasTerminalSession(sessionId)).toBe(false);
    });

    it('should return true when session exists', async () => {
      mockContainer.inspect.mockResolvedValue({});
      mockStream.on = jest.fn(() => mockStream);
      await service.createTerminalSession(containerId, sessionId);

      expect(service.hasTerminalSession(sessionId)).toBe(true);
    });
  });

  describe('getTerminalSessionsForContainer', () => {
    const containerId1 = 'container-1';
    const containerId2 = 'container-2';
    const sessionId1 = 'session-1';
    const sessionId2 = 'session-2';
    const sessionId3 = 'session-3';

    beforeEach(async () => {
      mockContainer.inspect.mockResolvedValue({});
      mockStream.on = jest.fn(() => mockStream);
    });

    it('should return empty array when no sessions exist', () => {
      expect(service.getTerminalSessionsForContainer(containerId1)).toEqual([]);
    });

    it('should return sessions for specific container', async () => {
      // Mock getContainer to return different containers
      const mockContainer1 = { ...mockContainer };
      const mockContainer2 = { ...mockContainer };

      (mockDocker.getContainer as jest.Mock).mockImplementation((id: string) => {
        if (id === containerId1) return mockContainer1;

        if (id === containerId2) return mockContainer2;

        return mockContainer;
      });

      mockContainer1.inspect.mockResolvedValue({});
      mockContainer2.inspect.mockResolvedValue({});

      await service.createTerminalSession(containerId1, sessionId1);
      await service.createTerminalSession(containerId1, sessionId2);
      await service.createTerminalSession(containerId2, sessionId3);

      const sessions1 = service.getTerminalSessionsForContainer(containerId1);
      const sessions2 = service.getTerminalSessionsForContainer(containerId2);

      expect(sessions1).toContain(sessionId1);
      expect(sessions1).toContain(sessionId2);
      expect(sessions1).not.toContain(sessionId3);
      expect(sessions2).toContain(sessionId3);
      expect(sessions2).not.toContain(sessionId1);
      expect(sessions2).not.toContain(sessionId2);
    });
  });

  describe('getContainerStatus', () => {
    const containerId = 'test-container-id';

    it('should return running true when container is running', async () => {
      mockContainer.inspect.mockResolvedValue({ State: { Running: true } });

      const result = await service.getContainerStatus(containerId);

      expect(mockContainer.inspect).toHaveBeenCalled();
      expect(result).toEqual({ running: true });
    });

    it('should return running false when container is stopped', async () => {
      mockContainer.inspect.mockResolvedValue({ State: { Running: false } });

      const result = await service.getContainerStatus(containerId);

      expect(mockContainer.inspect).toHaveBeenCalled();
      expect(result).toEqual({ running: false });
    });

    it('should return running false when State is missing', async () => {
      mockContainer.inspect.mockResolvedValue({});

      const result = await service.getContainerStatus(containerId);

      expect(mockContainer.inspect).toHaveBeenCalled();
      expect(result).toEqual({ running: false });
    });

    it('should throw NotFoundException when container does not exist', async () => {
      mockContainer.inspect.mockRejectedValue({ statusCode: 404 });

      await expect(service.getContainerStatus(containerId)).rejects.toThrow(NotFoundException);
      expect(mockContainer.inspect).toHaveBeenCalled();
    });

    it('should propagate non-404 inspection errors', async () => {
      const error = new Error('Docker daemon error') as Error & { statusCode?: number };

      error.statusCode = 500;
      mockContainer.inspect.mockRejectedValue(error);

      await expect(service.getContainerStatus(containerId)).rejects.toThrow('Docker daemon error');
      expect(mockContainer.inspect).toHaveBeenCalled();
    });
  });

  describe('getContainerEnvironmentMap', () => {
    it('returns parsed environment variables as key-value map', async () => {
      mockContainer.inspect.mockResolvedValue({
        Config: {
          Env: ['FOO=bar', 'COMPLEX=a=b=c'],
        },
      });

      const result = await service.getContainerEnvironmentMap('test-container-id');

      expect(result).toEqual({ FOO: 'bar', COMPLEX: 'a=b=c' });
    });
  });

  describe('getContainerStats', () => {
    const containerId = 'test-container-id';

    beforeEach(() => {
      mockContainer.inspect.mockResolvedValue({});
    });

    it('should get container stats successfully', async () => {
      const mockStats: Docker.ContainerStats = {
        read: '2024-01-01T00:00:00.000000000Z',
        preread: '2024-01-01T00:00:00.000000000Z',
        pids_stats: { current: 1 },
        blkio_stats: {
          io_service_bytes_recursive: [],
          io_serviced_recursive: [],
          io_queue_recursive: [],
          io_service_time_recursive: [],
          io_wait_time_recursive: [],
          io_merged_recursive: [],
          io_time_recursive: [],
          sectors_recursive: [],
        },
        num_procs: 0,
        storage_stats: {},
        cpu_stats: {
          cpu_usage: {
            total_usage: 1000000000,
            percpu_usage: [1000000000],
            usage_in_kernelmode: 100000000,
            usage_in_usermode: 900000000,
          },
          system_cpu_usage: 2000000000,
          online_cpus: 1,
          throttling_data: {
            periods: 0,
            throttled_periods: 0,
            throttled_time: 0,
          },
        },
        precpu_stats: {
          cpu_usage: {
            total_usage: 0,
            percpu_usage: [],
            usage_in_kernelmode: 0,
            usage_in_usermode: 0,
          },
          system_cpu_usage: 0,
          online_cpus: 1,
          throttling_data: {
            periods: 0,
            throttled_periods: 0,
            throttled_time: 0,
          },
        },
        memory_stats: {
          usage: 1000000,
          max_usage: 2000000,
          failcnt: 0,
          limit: 2000000,
          stats: {
            total_pgmajfault: 0,
            cache: 0,
            mapped_file: 0,
            total_inactive_file: 0,
            pgpgout: 0,
            rss: 0,
            total_mapped_file: 0,
            writeback: 0,
            unevictable: 0,
            pgpgin: 0,
            total_active_file: 0,
            active_anon: 0,
            total_active_anon: 0,
            total_inactive_anon: 0,
            inactive_anon: 0,
            active_file: 0,
            inactive_file: 0,
            total_unevictable: 0,
            total_rss: 0,
            total_rss_huge: 0,
            total_writeback: 0,
            total_cache: 0,
            rss_huge: 0,
            total_pgpgin: 0,
            total_pgpgout: 0,
            total_pgfault: 0,
            pgfault: 0,
            pgmajfault: 0,
            hierarchical_memory_limit: 0,
          },
        },
        networks: {},
      };

      (mockContainer.stats as jest.Mock) = jest.fn((options, callback) => {
        callback(null, mockStats);
      });

      const result = await service.getContainerStats(containerId);

      expect(mockContainer.inspect).toHaveBeenCalled();
      expect(mockContainer.stats).toHaveBeenCalledWith({ stream: false }, expect.any(Function));
      expect(result).toEqual(mockStats);
    });

    it('should throw NotFoundException when container does not exist', async () => {
      mockContainer.inspect.mockRejectedValue({ statusCode: 404 });

      await expect(service.getContainerStats(containerId)).rejects.toThrow(NotFoundException);
      expect(mockContainer.inspect).toHaveBeenCalled();
      expect(mockContainer.stats).not.toHaveBeenCalled();
    });

    it('should handle stats errors', async () => {
      const statsError = new Error('Stats error');

      (mockContainer.stats as jest.Mock) = jest.fn((options, callback) => {
        callback(statsError, null);
      });

      await expect(service.getContainerStats(containerId)).rejects.toThrow('Stats error');
      expect(mockContainer.stats).toHaveBeenCalled();
    });

    it('should handle container inspection errors other than 404', async () => {
      const error = new Error('Docker daemon error') as any;

      error.statusCode = 500;
      mockContainer.inspect.mockRejectedValue(error);

      await expect(service.getContainerStats(containerId)).rejects.toThrow('Docker daemon error');
      expect(mockContainer.stats).not.toHaveBeenCalled();
    });

    it('should call getContainer with correct containerId', async () => {
      const mockStats: Docker.ContainerStats = {
        read: '2024-01-01T00:00:00.000000000Z',
        preread: '2024-01-01T00:00:00.000000000Z',
        pids_stats: { current: 1 },
        blkio_stats: {
          io_service_bytes_recursive: [],
          io_serviced_recursive: [],
          io_queue_recursive: [],
          io_service_time_recursive: [],
          io_wait_time_recursive: [],
          io_merged_recursive: [],
          io_time_recursive: [],
          sectors_recursive: [],
        },
        num_procs: 0,
        storage_stats: {},
        cpu_stats: {
          cpu_usage: {
            total_usage: 1000000000,
            percpu_usage: [1000000000],
            usage_in_kernelmode: 100000000,
            usage_in_usermode: 900000000,
          },
          system_cpu_usage: 2000000000,
          online_cpus: 1,
          throttling_data: {
            periods: 0,
            throttled_periods: 0,
            throttled_time: 0,
          },
        },
        precpu_stats: {
          cpu_usage: {
            total_usage: 0,
            percpu_usage: [],
            usage_in_kernelmode: 0,
            usage_in_usermode: 0,
          },
          system_cpu_usage: 0,
          online_cpus: 1,
          throttling_data: {
            periods: 0,
            throttled_periods: 0,
            throttled_time: 0,
          },
        },
        memory_stats: {
          usage: 1000000,
          max_usage: 2000000,
          failcnt: 0,
          limit: 2000000,
          stats: {
            total_pgmajfault: 0,
            cache: 0,
            mapped_file: 0,
            total_inactive_file: 0,
            pgpgout: 0,
            rss: 0,
            total_mapped_file: 0,
            writeback: 0,
            unevictable: 0,
            pgpgin: 0,
            total_active_file: 0,
            active_anon: 0,
            total_active_anon: 0,
            total_inactive_anon: 0,
            inactive_anon: 0,
            active_file: 0,
            inactive_file: 0,
            total_unevictable: 0,
            total_rss: 0,
            total_rss_huge: 0,
            total_writeback: 0,
            total_cache: 0,
            rss_huge: 0,
            total_pgpgin: 0,
            total_pgpgout: 0,
            total_pgfault: 0,
            pgfault: 0,
            pgmajfault: 0,
            hierarchical_memory_limit: 0,
          },
        },
        networks: {},
      };

      (mockContainer.stats as jest.Mock) = jest.fn((options, callback) => {
        callback(null, mockStats);
      });

      await service.getContainerStats(containerId);

      expect(mockDocker.getContainer).toHaveBeenCalledWith(containerId);
    });
  });

  describe('ensureImageExists', () => {
    it('should not pull when image inspect succeeds', async () => {
      mockImage.inspect.mockResolvedValue({ Id: 'sha256:abc' });

      await service.ensureImageExists('node:22-alpine');

      expect(mockDocker.getImage).toHaveBeenCalledWith('node:22-alpine');
      expect(mockImage.inspect).toHaveBeenCalled();
      expect((mockDocker as any).pull).not.toHaveBeenCalled();
    });

    it('should pull when image inspect returns 404', async () => {
      mockImage.inspect.mockRejectedValue({ statusCode: 404 });

      await service.ensureImageExists('missing:image');

      expect(mockDocker.getImage).toHaveBeenCalledWith('missing:image');
      expect((mockDocker as any).pull).toHaveBeenCalledWith('missing:image');
    });

    it('should not pull when image inspect fails with a non-404 error', async () => {
      mockImage.inspect.mockRejectedValue({ statusCode: 500, message: 'server error' });

      await service.ensureImageExists('node:22-alpine');

      expect((mockDocker as any).pull).not.toHaveBeenCalled();
    });
  });
});
