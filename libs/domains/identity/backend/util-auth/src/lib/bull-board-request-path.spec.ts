import { isBullBoardRequestPath } from './bull-board-request-path';

describe('isBullBoardRequestPath', () => {
  const originalPath = process.env.QUEUE_BULL_BOARD_PATH;

  afterEach(() => {
    if (originalPath === undefined) {
      delete process.env.QUEUE_BULL_BOARD_PATH;
    } else {
      process.env.QUEUE_BULL_BOARD_PATH = originalPath;
    }
  });

  it('matches default /admin/queues and API subpaths', () => {
    delete process.env.QUEUE_BULL_BOARD_PATH;

    expect(isBullBoardRequestPath('/admin/queues')).toBe(true);
    expect(isBullBoardRequestPath('/admin/queues/api/queues/agent-controller/jobs/clean')).toBe(true);
    expect(isBullBoardRequestPath('/api/health')).toBe(false);
  });

  it('respects QUEUE_BULL_BOARD_PATH', () => {
    process.env.QUEUE_BULL_BOARD_PATH = '/ops/queues';

    expect(isBullBoardRequestPath('/ops/queues')).toBe(true);
    expect(isBullBoardRequestPath('/ops/queues/api/queues')).toBe(true);
    expect(isBullBoardRequestPath('/admin/queues')).toBe(false);
  });
});
