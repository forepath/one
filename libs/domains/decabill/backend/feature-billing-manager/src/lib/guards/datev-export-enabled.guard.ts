import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';

import { DatevExportConfigService } from '../services/datev-export-config.service';

@Injectable()
export class DatevExportEnabledGuard implements CanActivate {
  constructor(private readonly configService: DatevExportConfigService) {}

  canActivate(): boolean {
    if (!this.configService.isEnabled()) {
      throw new NotFoundException();
    }

    return true;
  }
}
