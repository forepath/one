import axios, { type InternalAxiosRequestConfig } from 'axios';

import { runWithCorrelationId } from './correlation-id.storage';
import {
  applySocketIoClientCorrelationHeaders,
  buildOutboundCorrelationHeaders,
  createCorrelationAwareSocketIoClient,
  registerAxiosCorrelationIdPropagation,
} from './outbound-correlation';

jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({ disconnect: jest.fn() })),
}));

describe('outbound-correlation', () => {
  it('adds X-Correlation-Id when AsyncLocalStorage has a value', async () => {
    const instance = axios.create({
      adapter: async (config) => {
        expect(config.headers?.get?.('X-Correlation-Id')).toBe('abc-123');
        return {
          data: {},
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      },
    });
    registerAxiosCorrelationIdPropagation(instance);

    await runWithCorrelationId('abc-123', async () => {
      await instance.get('http://example.test/x');
    });
  });

  it('does not override an existing X-Correlation-Id header', async () => {
    const instance = axios.create({
      adapter: async (config) => {
        expect(config.headers?.get?.('X-Correlation-Id')).toBe('preset');
        return {
          data: {},
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      },
    });
    registerAxiosCorrelationIdPropagation(instance);

    await runWithCorrelationId('from-als', async () => {
      await instance.get('http://example.test/z', { headers: { 'X-Correlation-Id': 'preset' } });
    });
  });

  it('leaves request unchanged when no correlation id in context', async () => {
    let correlationOnRequest: string | undefined;
    const instance = axios.create({
      adapter: async (config) => {
        correlationOnRequest = config.headers?.get?.('X-Correlation-Id') as string | undefined;
        return {
          data: {},
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      },
    });
    registerAxiosCorrelationIdPropagation(instance);

    await instance.get('http://example.test/n');

    expect(correlationOnRequest).toBeUndefined();
  });

  it('does not override when x-correlation-id is already set (plain object)', async () => {
    const instance = axios.create({
      adapter: async (config) => {
        expect(config.headers?.get?.('x-correlation-id')).toBe('already');
        return {
          data: {},
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      },
    });
    registerAxiosCorrelationIdPropagation(instance);

    await runWithCorrelationId('from-als', async () => {
      await instance.get('http://example.test/p', { headers: { 'x-correlation-id': 'already' } });
    });
  });

  it('merges header onto plain-object headers (no AxiosHeaders.set)', () => {
    let registered: ((c: InternalAxiosRequestConfig) => InternalAxiosRequestConfig) | undefined;
    const stub = {
      interceptors: {
        request: {
          use: (fn: (c: InternalAxiosRequestConfig) => InternalAxiosRequestConfig) => {
            registered = fn;
            return 0;
          },
        },
      },
    };
    registerAxiosCorrelationIdPropagation(stub as Parameters<typeof registerAxiosCorrelationIdPropagation>[0]);

    runWithCorrelationId('plain-merge', () => {
      const config = {
        headers: { Accept: 'application/json' },
      } as unknown as InternalAxiosRequestConfig;
      const result = registered?.(config);
      expect((result?.headers as Record<string, string>)['X-Correlation-Id']).toBe('plain-merge');
    });
  });

  it('creates AxiosHeaders when config.headers is missing', () => {
    let registered: ((c: InternalAxiosRequestConfig) => InternalAxiosRequestConfig) | undefined;
    const stub = {
      interceptors: {
        request: {
          use: (fn: (c: InternalAxiosRequestConfig) => InternalAxiosRequestConfig) => {
            registered = fn;
            return 0;
          },
        },
      },
    };
    registerAxiosCorrelationIdPropagation(stub as Parameters<typeof registerAxiosCorrelationIdPropagation>[0]);

    runWithCorrelationId('no-headers', () => {
      const config = {} as InternalAxiosRequestConfig;
      const result = registered?.(config);
      expect((result?.headers as Record<string, string>)['X-Correlation-Id']).toBe('no-headers');
    });
  });

  describe('socket.io-client handshake', () => {
    const { io } = jest.requireMock('socket.io-client') as { io: jest.Mock };

    beforeEach(() => {
      io.mockClear();
    });

    it('buildOutboundCorrelationHeaders adds X-Correlation-Id from ALS', () => {
      runWithCorrelationId('ws-1', () => {
        expect(buildOutboundCorrelationHeaders({ Authorization: 'Bearer a' })).toEqual({
          Authorization: 'Bearer a',
          'X-Correlation-Id': 'ws-1',
        });
      });
    });

    it('applySocketIoClientCorrelationHeaders merges extraHeaders', () => {
      runWithCorrelationId('ws-2', () => {
        const out = applySocketIoClientCorrelationHeaders({
          transports: ['websocket'],
          extraHeaders: { Authorization: 'Bearer b' },
        });
        expect(out.extraHeaders).toEqual({
          Authorization: 'Bearer b',
          'X-Correlation-Id': 'ws-2',
        });
      });
    });

    it('createCorrelationAwareSocketIoClient forwards options to io() with correlation', () => {
      runWithCorrelationId('ws-3', () => {
        createCorrelationAwareSocketIoClient('http://agent-manager/agents', {
          transports: ['websocket'],
          extraHeaders: { Authorization: 'Bearer c' },
        });
        expect(io).toHaveBeenCalledWith(
          'http://agent-manager/agents',
          expect.objectContaining({
            extraHeaders: {
              Authorization: 'Bearer c',
              'X-Correlation-Id': 'ws-3',
            },
            transports: ['websocket'],
          }),
        );
      });
    });
  });
});
