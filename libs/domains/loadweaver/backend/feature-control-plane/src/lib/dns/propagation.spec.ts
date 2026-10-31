import { verifyPropagation } from './propagation';

describe('verifyPropagation', () => {
  it('waits until every authoritative server answers the new addresses', async () => {
    let round = 0;
    const query = async (server: string) => {
      round++;

      return server === 'ns2' && round < 4 ? ['203.0.113.10'] : ['198.51.100.10'];
    };

    expect(
      await verifyPropagation('shop.example.com', ['198.51.100.10'], ['ns1', 'ns2'], query, {
        intervalMs: 1,
        timeoutMs: 1000,
      }),
    ).toEqual({ done: true, lagging: [] });
  });

  it('reports servers still lagging at the deadline', async () => {
    expect(
      await verifyPropagation(
        'shop.example.com',
        ['198.51.100.10'],
        ['ns1', 'ns2'],
        async (s) => (s === 'ns1' ? ['198.51.100.10'] : null),
        { intervalMs: 1, timeoutMs: 20 },
      ),
    ).toEqual({ done: false, lagging: ['ns2'] });
  });

  it('accepts any part of the healthy endpoints for steered answers', async () => {
    const answers: Record<string, string[]> = { a: ['203.0.113.1'], b: ['203.0.113.2'], c: ['192.0.2.9'] };
    const query = async (server: string) => answers[server] ?? null;

    expect(
      await verifyPropagation('www.example.com', ['203.0.113.1', '203.0.113.2'], ['a', 'b', 'c'], query, {
        subset: true,
        timeoutMs: 0,
      }),
    ).toEqual({ done: false, lagging: ['c'] });
  });
});
