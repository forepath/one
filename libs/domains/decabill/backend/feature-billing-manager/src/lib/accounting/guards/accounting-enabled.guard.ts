import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';

import { AccountingConfigService } from '../services/accounting-config.service';

/** Hides all accounting routes (404) unless accounting is enabled and its prerequisites are configured. */
@Injectable()
export class AccountingEnabledGuard implements CanActivate {
  constructor(private readonly config: AccountingConfigService) {}

  canActivate(): boolean {
    if (!this.config.isEnabled()) {
      throw new NotFoundException();
    }

    return true;
  }
}
