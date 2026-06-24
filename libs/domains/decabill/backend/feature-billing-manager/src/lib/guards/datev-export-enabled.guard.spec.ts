import { NotFoundException } from '@nestjs/common';

import { DatevExportEnabledGuard } from './datev-export-enabled.guard';

describe('DatevExportEnabledGuard', () => {
  const configService = {
    isEnabled: jest.fn(),
  };
  const guard = new DatevExportEnabledGuard(configService as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows access when DATEV export is enabled', () => {
    configService.isEnabled.mockReturnValue(true);

    expect(guard.canActivate()).toBe(true);
  });

  it('throws NotFoundException when DATEV export is disabled', () => {
    configService.isEnabled.mockReturnValue(false);

    expect(() => guard.canActivate()).toThrow(NotFoundException);
  });
});
