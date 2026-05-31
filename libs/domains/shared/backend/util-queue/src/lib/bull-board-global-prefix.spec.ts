import { RequestMethod } from '@nestjs/common';

import { getBullBoardGlobalPrefixExcludes } from './bull-board-global-prefix';

describe('getBullBoardGlobalPrefixExcludes', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns empty when Bull Board is disabled', () => {
    process.env.QUEUE_BULL_BOARD_ENABLED = 'false';

    expect(getBullBoardGlobalPrefixExcludes()).toEqual([]);
  });

  it('excludes configured Bull Board path from global prefix', () => {
    process.env.QUEUE_BULL_BOARD_ENABLED = 'true';
    process.env.QUEUE_BULL_BOARD_PATH = '/admin/queues';

    expect(getBullBoardGlobalPrefixExcludes()).toEqual([
      { path: 'admin/queues', method: RequestMethod.ALL },
      { path: 'admin/queues/*path', method: RequestMethod.ALL },
    ]);
  });
});
