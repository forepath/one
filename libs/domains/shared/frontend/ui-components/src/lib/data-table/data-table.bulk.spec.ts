import { fpcBulkSummary, fpcRunBulk } from './data-table.bulk';

describe('fpcRunBulk', () => {
  it('reports every item: succeeded, denied (401 / 403, never counted as success) or failed', async () => {
    const result = await fpcRunBulk(['a', 'b', 'c', 'd'], async (item) => {
      if (item === 'b') throw { status: 403, error: { message: 'Forbidden' } };
      if (item === 'c') throw { status: 500, error: { message: 'Boom' } };

      return item;
    });

    expect(result.succeeded).toEqual(['a', 'd']);
    expect(result.denied).toEqual(['b']);
    expect(result.failed).toEqual(['c']);
    expect(fpcBulkSummary(result, (item) => item)).toEqual({
      tone: 'warning',
      message: '2 done · 1 not allowed · 1 failed: b (Forbidden), c (Boom)',
    });
  });

  it('limits concurrency', async () => {
    let running = 0;
    let peak = 0;

    await fpcRunBulk(
      [1, 2, 3, 4, 5, 6],
      async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running--;
      },
      2,
    );

    expect(peak).toBe(2);
  });
});
