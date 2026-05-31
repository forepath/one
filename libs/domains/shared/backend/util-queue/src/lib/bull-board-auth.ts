import type { LoggerService } from '@nestjs/common';

import { createBullBoardAuthMiddleware } from './bull-board-auth.middleware';
import { isBullBoardAuthConfigured, readBullBoardAuthConfig } from './queue-connection.config';
import { shouldEnableBullBoard } from './queue-role';

export function createBullBoardAuthMiddlewareFromEnv(): ReturnType<typeof createBullBoardAuthMiddleware> {
  return createBullBoardAuthMiddleware(readBullBoardAuthConfig());
}

/**
 * Ensures Bull Board is not exposed without credentials in production.
 */
export function assertBullBoardAuthConfigured(logger?: Pick<LoggerService, 'warn' | 'error'>): void {
  if (!shouldEnableBullBoard() || isBullBoardAuthConfigured()) {
    return;
  }

  const message =
    'QUEUE_BULL_BOARD_PASSWORD must be set when Bull Board is enabled (QUEUE_BULL_BOARD_USERNAME defaults to admin)';

  if (process.env.NODE_ENV === 'production') {
    throw new Error(message);
  }

  logger?.warn(`${message}; Bull Board will reject requests until configured`);
}
