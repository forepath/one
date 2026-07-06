import { ForbiddenException } from '@nestjs/common';

import type { UserInfoFromRequest } from '../utils/marpdown-access.utils';
import type { PresentationEntity } from '../entities/presentation.entity';

export function ensurePresentationOwner(userInfo: UserInfoFromRequest, presentation: PresentationEntity): void {
  if (userInfo.isApiKeyAuth) {
    throw new ForbiddenException('User not authenticated');
  }

  if (!userInfo.userId || presentation.userId !== userInfo.userId) {
    throw new ForbiddenException('Access denied');
  }
}
