import { LoadweaverApiError, LoadweaverClient, loadweaverRuntimeConfig } from './loadweaver-client';

const jwt = (exp: number) => `h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.s`;

function fakeFetch(responses: Record<string, (body: unknown) => { status: number; body: unknown }>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });

    const key = `${init.method} ${url.replace('https://lw.test/api', '').split('?')[0]}`;
    const handler = responses[key];
    const result = handler
      ? handler(init.body ? JSON.parse(String(init.body)) : undefined)
      : { status: 404, body: { message: 'nope' } };

    return new Response(JSON.stringify(result.body), { status: result.status });
  });

  return { impl: impl as unknown as typeof fetch, calls };
}

describe('LoadweaverClient', () => {
  const config = (token: string) => ({ url: 'https://lw.test', project: 'ws', token: () => token, volumeSize: '20g' });

  it('exchanges a PAT for a machine session once and reuses it until shortly before it expires', async () => {
    const session = jwt(Math.floor(Date.now() / 1000) + 3600);
    const { impl, calls } = fakeFetch({
      'POST /auth/token': () => ({ status: 200, body: { access_token: session } }),
      'GET /resources': () => ({
        status: 200,
        body: [
          { kind: 'Policy', metadata: { name: 'a', project: 'ws' } },
          { kind: 'Policy', metadata: { name: 'b', project: 'other' } },
        ],
      }),
    });
    const client = new LoadweaverClient(config('fp_pat_abc'), impl);

    expect((await client.listResources('Policy')).map((r) => r.metadata.name)).toEqual(['a']);
    await client.listResources('Policy');
    expect(calls.filter((c) => c.url.endsWith('/auth/token'))).toHaveLength(1);
    expect((calls.at(-1)?.init.headers as Record<string, string>).authorization).toBe(`Bearer ${session}`);
  });

  it('uses other bearer tokens directly', async () => {
    const { impl, calls } = fakeFetch({ 'GET /resources': () => ({ status: 200, body: [] }) });

    await new LoadweaverClient(config('static-key'), impl).listResources('Policy');
    expect(calls).toHaveLength(1);
  });

  it('plans and applies, planning again when the plan went stale, and reports plan errors', async () => {
    let applies = 0;
    const { impl } = fakeFetch({
      'POST /plans': () => ({ status: 201, body: { id: `p${applies}`, status: 'pending', changes: [{}] } }),
      'POST /plans/p0/apply': () => (applies++, { status: 409, body: { message: 'cluster changed' } }),
      'POST /plans/p1/apply': () => ({ status: 200, body: { id: 'p1', status: 'applied', changes: [] } }),
      'POST /plans/p0/discard': () => ({ status: 200, body: {} }),
    });
    const client = new LoadweaverClient(config('k'), impl);

    expect((await client.applyChange({ documents: 'x' })).id).toBe('p1');

    const failing = new LoadweaverClient(
      config('k'),
      fakeFetch({
        'POST /plans': () => ({ status: 400, body: { issues: [{ message: 'denyUrlPatterns[0]: bad' }] } }),
      }).impl,
    );

    await expect(failing.applyChange({ documents: 'x' })).rejects.toThrow('denyUrlPatterns[0]: bad');
    await expect(failing.applyChange({ documents: 'x' })).rejects.toBeInstanceOf(LoadweaverApiError);
  });

  it('follows a plan the apply answered as still applying until it settles (G5)', async () => {
    let polls = 0;
    const { impl, calls } = fakeFetch({
      'POST /plans': () => ({ status: 201, body: { id: 'p1', status: 'pending', changes: [{}] } }),
      'POST /plans/p1/apply': () => ({ status: 200, body: { id: 'p1', status: 'applying', changes: [] } }),
      'GET /plans/p1': () => ({
        status: 200,
        body: { id: 'p1', status: ++polls < 3 ? 'applying' : 'applied', changes: [] },
      }),
    });
    const client = new LoadweaverClient(config('k'), impl);

    client.planPollMs = 1;
    expect((await client.applyChange({ documents: 'x' })).status).toBe('applied');
    expect(polls).toBe(3);
    expect(calls.some((c) => c.url.includes('/discard'))).toBe(false);

    // A plan that rolls back still fails, with its error.
    const failing = new LoadweaverClient(
      config('k'),
      fakeFetch({
        'POST /plans': () => ({ status: 201, body: { id: 'p2', status: 'pending', changes: [{}] } }),
        'POST /plans/p2/apply': () => ({ status: 200, body: { id: 'p2', status: 'rolling-back', changes: [] } }),
        'GET /plans/p2': () => ({
          status: 200,
          body: { id: 'p2', status: 'rolled-back', error: 'image pull failed', changes: [] },
        }),
        'POST /plans/p2/discard': () => ({ status: 200, body: {} }),
      }).impl,
    );

    failing.planPollMs = 1;
    await expect(failing.applyChange({ documents: 'x' })).rejects.toThrow(
      'plan p2 ended rolled-back: image pull failed',
    );
  });

  it("reads the project's aggregated isolation capabilities, optionally narrowed by a selector", async () => {
    const view = { project: 'ws', nodes: 1, levels: { microvm: { state: 'ready', nodes: 1 } } };
    const { impl, calls } = fakeFetch({
      'GET /projects/ws/isolation-capabilities': () => ({ status: 200, body: view }),
    });
    const client = new LoadweaverClient(config('k'), impl);

    expect(await client.isolationCapabilities()).toEqual(view);
    await client.isolationCapabilities('pool=kvm,loadweaver.com/site=fra1');
    expect(calls.map((c) => c.url)).toEqual([
      'https://lw.test/api/projects/ws/isolation-capabilities',
      'https://lw.test/api/projects/ws/isolation-capabilities?selector=pool%3Dkvm%2Cloadweaver.com%2Fsite%3Dfra1',
    ]);
  });

  it('reads its configuration from the environment', () => {
    expect(() => loadweaverRuntimeConfig({})).toThrow('LOADWEAVER_URL');
    expect(() => loadweaverRuntimeConfig({ LOADWEAVER_URL: 'https://x' })).toThrow('LOADWEAVER_PROJECT');
    expect(() => loadweaverRuntimeConfig({ LOADWEAVER_URL: 'https://x', LOADWEAVER_PROJECT: 'ws' })).toThrow('TOKEN');

    const parsed = loadweaverRuntimeConfig({
      LOADWEAVER_URL: 'https://x/',
      LOADWEAVER_PROJECT: 'ws',
      LOADWEAVER_TOKEN: 't',
    });

    expect(parsed).toMatchObject({ url: 'https://x', project: 'ws', volumeSize: '20g' });
    expect(parsed.token()).toBe('t');
  });
});
