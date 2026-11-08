import { BadGatewayException, BadRequestException, GatewayTimeoutException, NotFoundException } from '@nestjs/common';

import {
  deploymentFetch,
  deploymentProviderHttpError,
  deploymentRequest,
  deploymentRequestJson,
  encodeDeploymentPathSegment,
  extractDeploymentProviderErrorMessage,
  joinDeploymentJobLogs,
  normalizeDeploymentBaseUrl,
  readDeploymentTextTail,
  sanitizeDeploymentProviderMessage,
  tailDeploymentText,
} from './deployment-http.util';

const ctx = { providerLabel: 'GitHub', action: 'list repositories', secrets: ['super-secret-token'] };

describe('deployment-http.util', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('normalizeDeploymentBaseUrl', () => {
    it('strips trailing slashes and keeps the path', () => {
      expect(normalizeDeploymentBaseUrl(' https://ghe.example.com/api/v3/ ')).toBe('https://ghe.example.com/api/v3');
      expect(normalizeDeploymentBaseUrl('http://jenkins:8080')).toBe('http://jenkins:8080');
    });

    it.each([
      ['', 'empty'],
      ['ftp://host', 'protocol'],
      ['not a url', 'relative'],
      ['https://user:pw@host', 'credentials'],
      ['https://host/?a=1', 'query'],
      ['https://host/#x', 'fragment'],
    ])('rejects %s (%s)', (raw) => {
      expect(() => normalizeDeploymentBaseUrl(raw)).toThrow(BadRequestException);
    });
  });

  it('encodes path segments and rejects traversal', () => {
    expect(encodeDeploymentPathSegment('a/b c')).toBe('a%2Fb%20c');
    expect(() => encodeDeploymentPathSegment('..')).toThrow(BadRequestException);
    expect(() => encodeDeploymentPathSegment('')).toThrow(BadRequestException);
    expect(() => encodeDeploymentPathSegment('a\nb')).toThrow(BadRequestException);
  });

  it('sanitizes secrets, tokens and credentials from messages', () => {
    const msg = sanitizeDeploymentProviderMessage(
      'bad super-secret-token Bearer abcdefghijklmnop ghp_abcdefghijklmnopqrst https://u:p@host/x',
      ['super-secret-token'],
    );

    expect(msg).not.toContain('super-secret-token');
    expect(msg).not.toContain('abcdefghijklmnop');
    expect(msg).not.toContain('ghp_');
    expect(msg).not.toContain('u:p@');
    expect(sanitizeDeploymentProviderMessage('x'.repeat(1000), [], 50)).toHaveLength(50);
  });

  it('extracts provider error messages', () => {
    expect(extractDeploymentProviderErrorMessage('{"message":"Bad","errors":[{"message":"x"}]}')).toBe('Bad; x');
    expect(extractDeploymentProviderErrorMessage('<html>oops</html>')).toBe('');
    expect(extractDeploymentProviderErrorMessage('plain')).toBe('plain');
  });

  it('maps HTTP statuses to Nest exceptions without secrets', () => {
    expect(deploymentProviderHttpError(404, '', ctx)).toBeInstanceOf(NotFoundException);
    expect(deploymentProviderHttpError(422, '{"message":"nope"}', ctx)).toBeInstanceOf(BadRequestException);
    const unauthorized = deploymentProviderHttpError(401, '{"message":"super-secret-token invalid"}', ctx);

    expect(unauthorized).toBeInstanceOf(BadGatewayException);
    expect(unauthorized.message).not.toContain('super-secret-token');
    expect(deploymentProviderHttpError(500, '{"message":"super-secret-token"}', ctx).message).not.toContain(
      'super-secret-token',
    );
  });

  it('throws mapped errors for non-2xx responses and parses JSON', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('{"a":1}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"message":"missing"}', { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/x' } }));

    await expect(deploymentRequestJson('https://h/x', {}, ctx)).resolves.toEqual({ a: 1 });
    await expect(deploymentRequest('https://h/x', {}, ctx)).rejects.toBeInstanceOf(NotFoundException);
    await expect(deploymentRequest('https://h/x', { redirect: 'manual' }, ctx)).resolves.toBeInstanceOf(Response);
    expect(fetchMock.mock.calls[0][1]?.signal).toBeDefined();
  });

  it('maps aborts to gateway timeouts and network errors to bad gateway', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );

    await expect(deploymentFetch('https://h', { timeoutMs: 5 }, ctx)).rejects.toBeInstanceOf(GatewayTimeoutException);

    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('getaddrinfo super-secret-token'));

    const err = await deploymentFetch('https://h', {}, ctx).catch((e: Error) => e);

    expect(err).toBeInstanceOf(BadGatewayException);
    expect((err as Error).message).not.toContain('super-secret-token');
  });

  it('reads only the tail of a streamed body', async () => {
    const chunks = ['aaaa', 'bbbb', 'cccc'];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) {
          controller.enqueue(new TextEncoder().encode(c));
        }

        controller.close();
      },
    });

    await expect(readDeploymentTextTail(new Response(stream), 6)).resolves.toEqual({ text: 'bbcccc', truncated: true });
    await expect(readDeploymentTextTail(new Response('short'), 100)).resolves.toEqual({
      text: 'short',
      truncated: false,
    });
  });

  it('tails strings and joins job logs', () => {
    expect(tailDeploymentText('abcdef', 3)).toEqual({ text: 'def', truncated: true });
    expect(tailDeploymentText('é'.repeat(3), 3).text).toBe('é');
    expect(
      joinDeploymentJobLogs(
        [
          { name: 'a', logs: 'one', truncated: false },
          { name: 'b', logs: 'two', truncated: false },
        ],
        1000,
      ),
    ).toEqual({ logs: '===== a =====\none\n\n===== b =====\ntwo', truncated: false });
  });
});
