import { ForbiddenException } from '@nestjs/common';

import type { PresentationEntity } from '../entities/presentation.entity';
import { ensurePresentationOwner } from './presentation-access.utils';

describe('ensurePresentationOwner', () => {
  const presentation = { userId: 'user-1' } as PresentationEntity;

  it('allows owner access', () => {
    expect(() =>
      ensurePresentationOwner({ userId: 'user-1', isApiKeyAuth: false }, presentation),
    ).not.toThrow();
  });

  it('denies other users including admins', () => {
    expect(() =>
      ensurePresentationOwner({ userId: 'user-2', isApiKeyAuth: false }, presentation),
    ).toThrow(ForbiddenException);
  });

  it('denies api key auth', () => {
    expect(() =>
      ensurePresentationOwner({ isApiKeyAuth: true }, presentation),
    ).toThrow(ForbiddenException);
  });
});
