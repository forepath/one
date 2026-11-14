import { EventEmitter } from 'events';

import { Client } from 'ssh2';

import { waitForTcpPort } from '../utils/wait-for-tcp-port.util';

import { SshExecutorService } from './ssh-executor.service';

jest.mock('../utils/wait-for-tcp-port.util', () => ({
  waitForTcpPort: jest.fn(),
}));

jest.mock('ssh2', () => ({
  Client: jest.fn(),
}));

const mockedWaitForTcpPort = waitForTcpPort as jest.MockedFunction<typeof waitForTcpPort>;
const MockClient = Client as unknown as jest.Mock;

class FakeStream extends EventEmitter {
  stderr = new EventEmitter();
}

class FakeClient extends EventEmitter {
  exec = jest.fn();
  end = jest.fn();
  connect = jest.fn(() => this);
}

describe('SshExecutorService', () => {
  let service: SshExecutorService;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
    service = new SshExecutorService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('waitUntilReachable', () => {
    it('resolves when TCP becomes reachable', async () => {
      mockedWaitForTcpPort.mockResolvedValue(undefined);

      await expect(service.waitUntilReachable('1.2.3.4', 22, { timeoutMs: 5_000 })).resolves.toBeUndefined();
      expect(mockedWaitForTcpPort).toHaveBeenCalledWith('1.2.3.4', 22, { timeoutMs: 5_000 });
    });

    it('uses the default timeout and remaps wait failures', async () => {
      mockedWaitForTcpPort.mockRejectedValue(new Error('Timed out waiting'));

      await expect(service.waitUntilReachable('1.2.3.4', 22)).rejects.toThrow(
        'Timed out waiting for SSH on 1.2.3.4:22 after 300000ms',
      );
    });
  });

  describe('exec', () => {
    it('resolves stdout/stderr/code when the remote command closes', async () => {
      const client = new FakeClient();
      const stream = new FakeStream();

      MockClient.mockImplementation(() => client);
      client.exec.mockImplementation((_command: string, cb: (err: Error | null, stream: FakeStream) => void) => {
        cb(null, stream);
      });

      const promise = service.exec('1.2.3.4', 22, 'root', 'PRIVATE', 'true');

      client.emit('ready');
      stream.emit('data', Buffer.from('out'));
      stream.stderr.emit('data', Buffer.from('err'));
      stream.emit('close', 0);

      await expect(promise).resolves.toEqual({ stdout: 'out', stderr: 'err', code: 0 });
      expect(client.end).toHaveBeenCalled();
      expect(client.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          host: '1.2.3.4',
          port: 22,
          username: 'root',
          privateKey: 'PRIVATE',
        }),
      );
    });

    it('rejects when client.exec fails', async () => {
      const client = new FakeClient();

      MockClient.mockImplementation(() => client);
      client.exec.mockImplementation((_command: string, cb: (err: Error | null, stream?: FakeStream) => void) => {
        cb(new Error('exec failed'));
      });

      const promise = service.exec('1.2.3.4', 22, 'root', 'PRIVATE', 'true');

      client.emit('ready');

      await expect(promise).rejects.toThrow('exec failed');
      expect(client.end).toHaveBeenCalled();
    });

    it('rejects on connection error', async () => {
      const client = new FakeClient();

      MockClient.mockImplementation(() => client);

      const promise = service.exec('1.2.3.4', 22, 'root', 'PRIVATE', 'true');

      client.emit('error', new Error('ECONNRESET'));

      await expect(promise).rejects.toThrow('ECONNRESET');
    });

    it('rejects when the command timeout elapses', async () => {
      const client = new FakeClient();

      MockClient.mockImplementation(() => client);

      const promise = service.exec('1.2.3.4', 22, 'root', 'PRIVATE', 'sleep 60', {
        commandTimeoutMs: 100,
      });
      const expectation = expect(promise).rejects.toThrow('SSH command timed out after 100ms');

      await jest.advanceTimersByTimeAsync(100);
      await expectation;
      expect(client.end).toHaveBeenCalled();
    });

    it('ignores a second settle after the command already finished', async () => {
      const client = new FakeClient();
      const stream = new FakeStream();

      MockClient.mockImplementation(() => client);
      client.exec.mockImplementation((_command: string, cb: (err: Error | null, stream: FakeStream) => void) => {
        cb(null, stream);
      });

      const promise = service.exec('1.2.3.4', 22, 'root', 'PRIVATE', 'true', { commandTimeoutMs: 5_000 });

      client.emit('ready');
      stream.emit('close', 0);
      stream.emit('close', 1);

      await expect(promise).resolves.toEqual({ stdout: '', stderr: '', code: 0 });
      expect(client.end).toHaveBeenCalledTimes(1);
    });
  });
});
