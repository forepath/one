import { ExecutionContext } from '@nestjs/common';

import { BullBoardSkippingThrottlerGuard } from './bull-board-throttler.guard';

describe('BullBoardSkippingThrottlerGuard', () => {
  function createContext(path: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ originalUrl: path, url: path }),
      }),
    } as ExecutionContext;
  }

  it('skips throttling on Bull Board paths', async () => {
    const guard = Object.create(BullBoardSkippingThrottlerGuard.prototype) as BullBoardSkippingThrottlerGuard;

    await expect(guard['shouldSkip'](createContext('/admin/queues'))).resolves.toBe(true);
  });
});
