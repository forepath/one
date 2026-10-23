import {
  httpsOrigin,
  PostureHttp,
  PostureHttpError,
  retryAfterMs,
  safeErrorMessage,
  type FetchLike,
} from './posture-http';

function sequence(...responses: (() => Response | Promise<Response>)[]): { fetch: FetchLike; calls: RequestInit[] } {
  const calls: RequestInit[] = [];
  let i = 0;

  return {
    calls,
    fetch: async (_url, init) => {
      calls.push(init);

      return await responses[Math.min(i++, responses.length - 1)]();
    },
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('PostureHttp', () => {
  it('calls only https URLs on allowed hosts, without following redirects', async () => {
    const fake = sequence(() => json({ ok: true }));
    const sleeps: number[] = [];
    const http = new PostureHttp({
      allowedHosts: ['api.example.com'],
      fetchImpl: fake.fetch,
      sleep: async (ms) => void sleeps.push(ms),
    });

    await expect(http.json({ url: 'https://api.example.com/x' })).resolves.toEqual({ ok: true });
    expect(fake.calls[0].redirect).toBe('error');
    expect(fake.calls[0].signal).toBeDefined();
    await expect(http.json({ url: 'http://api.example.com/x' })).rejects.toThrow(/https/);
    await expect(http.json({ url: 'https://other.example.com/x' })).rejects.toThrow(/not allowed/);
    await expect(http.json({ url: 'https://u:p@api.example.com/x' })).rejects.toThrow(/credentials/);
    expect(fake.calls).toHaveLength(1);
  });

  it('retries 429 / 5xx honouring Retry-After, then gives up with the status', async () => {
    const sleeps: number[] = [];
    const fake = sequence(
      () => json({}, 429, { 'retry-after': '3' }),
      () => json({}, 503),
      () => json({ value: [1] }),
    );
    const http = new PostureHttp({
      allowedHosts: ['api.example.com'],
      fetchImpl: fake.fetch,
      sleep: async (ms) => void sleeps.push(ms),
    });

    await expect(http.json({ url: 'https://api.example.com/devices' })).resolves.toEqual({ value: [1] });
    expect(sleeps).toEqual([3000, 2000]);

    const failing = new PostureHttp({
      allowedHosts: ['api.example.com'],
      fetchImpl: sequence(() => json({ error: 'busy' }, 503)).fetch,
      sleep: async () => undefined,
    });
    const error = await failing
      .json({ url: 'https://api.example.com/devices?token=abc' })
      .catch((e: PostureHttpError) => e);

    expect(error).toBeInstanceOf(PostureHttpError);
    expect((error as PostureHttpError).status).toBe(503);
    // The query (which may carry tokens) never appears in errors.
    expect((error as Error).message).toBe('GET api.example.com/devices answered 503');
  });

  it('sends form bodies for token requests and bounds requests and response sizes', async () => {
    const fake = sequence(() => json({ access_token: 't' }));
    const http = new PostureHttp({ allowedHosts: ['login.example.com'], fetchImpl: fake.fetch, maxRequests: 1 });

    await http.json({ method: 'POST', url: 'https://login.example.com/token', form: { client_secret: 'a b' } });
    expect((fake.calls[0].headers as Record<string, string>)['content-type']).toBe('application/x-www-form-urlencoded');
    expect(fake.calls[0].body).toBe('client_secret=a+b');
    await expect(http.json({ url: 'https://login.example.com/token' })).rejects.toThrow(/budget/);

    const big = new PostureHttp({
      allowedHosts: ['api.example.com'],
      fetchImpl: sequence(() => new Response('x'.repeat(2_000))).fetch,
      maxResponseBytes: 1_000,
    });

    await expect(big.json({ url: 'https://api.example.com/' })).rejects.toThrow(/too large/);
  });

  it('reports timeouts and connection errors without details', async () => {
    const http = new PostureHttp({
      allowedHosts: ['api.example.com'],
      fetchImpl: async () => {
        throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      },
      maxAttempts: 2,
      sleep: async () => undefined,
    });

    await expect(http.json({ url: 'https://api.example.com/x' })).rejects.toThrow('GET api.example.com/x: timed out');
  });
});

describe('posture http helpers', () => {
  it('parses Retry-After as seconds or a date, capped at a minute', () => {
    expect(retryAfterMs('5')).toBe(5000);
    expect(retryAfterMs('600')).toBe(60_000);
    expect(
      retryAfterMs(new Date(Date.parse('2026-10-20T10:00:10Z')).toUTCString(), Date.parse('2026-10-20T10:00:00Z')),
    ).toBe(10_000);
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs('soon')).toBeNull();
  });

  it('validates configured base URLs', () => {
    expect(httpsOrigin('https://acme.jamfcloud.com/', 'baseUrl').hostname).toBe('acme.jamfcloud.com');
    expect(() => httpsOrigin('ftp://acme.example.com', 'baseUrl')).toThrow(/https/);
    expect(() => httpsOrigin('https://[::1]', 'baseUrl')).toThrow(/host/);
    expect(() => httpsOrigin('https://192.168.1.10', 'baseUrl')).toThrow(/host/);
    expect(() => httpsOrigin('https://acme.example.com/#x', 'baseUrl')).toThrow(/fragment/);
    expect(() => httpsOrigin(undefined, 'baseUrl')).toThrow(/https/);
  });

  it('keeps stored error messages short and single-line', () => {
    expect(safeErrorMessage(new Error(`a\nb${'x'.repeat(400)}`))).toHaveLength(300);
    expect(safeErrorMessage(new TypeError('fetch failed: secret'))).toBe('posture integration failed');
    expect(safeErrorMessage('x')).toBe('posture integration failed');
  });
});
