import { RequestMethod } from '@nestjs/common';
import type { RouteInfo } from '@nestjs/common/interfaces';

import { readBullBoardPath } from './queue-connection.config';
import { shouldEnableBullBoard } from './queue-role';

/**
 * Routes excluded from Nest's global prefix so Bull Board stays at QUEUE_BULL_BOARD_PATH
 * (e.g. /admin/queues) instead of /api/admin/queues.
 */
export function getBullBoardGlobalPrefixExcludes(env: NodeJS.ProcessEnv = process.env): RouteInfo[] {
  if (!shouldEnableBullBoard()) {
    return [];
  }

  const route = readBullBoardPath(env).replace(/^\//, '');

  return [
    { path: route, method: RequestMethod.ALL },
    { path: `${route}/*path`, method: RequestMethod.ALL },
  ];
}
