import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { isBullBoardRequestPath } from './bull-board-request-path';
import { getHttpRequestPath } from './http-request-path.util';

/** Skips rate limiting on Bull Board routes (dashboard actions can burst). */
@Injectable()
export class BullBoardSkippingThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (isBullBoardRequestPath(getHttpRequestPath(context))) {
      return true;
    }

    return super.shouldSkip(context);
  }
}
