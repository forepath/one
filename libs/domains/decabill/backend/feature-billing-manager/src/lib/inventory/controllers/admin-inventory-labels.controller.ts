import { RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import { Body, Controller, Get, HttpCode, Post, Req, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';

import { SpoolPrintoutService } from '../../spooler/spool-printout.service';
import { mapSpoolJob, type SpoolJobResponseDto } from '../../spooler/spooler.dto';
import { getUserFromRequest, type RequestWithUser } from '../../utils/billing-access.utils';
import { type InventoryLabelOwnerResponseDto, PrintInventoryLabelsDto } from '../dto/inventory.dto';
import { InventoryLabelsService } from '../services/inventory-labels.service';

@Controller('admin/billing/inventory/labels')
@UsersRoles(UserRole.ADMIN, UserRole.MANAGER)
export class AdminInventoryLabelsController {
  constructor(
    private readonly labels: InventoryLabelsService,
    private readonly printouts: SpoolPrintoutService,
  ) {}

  /** Company data printed on property stickers (for previews). */
  @RequireScopes('inventory:admin')
  @Get('owner')
  owner(): InventoryLabelOwnerResponseDto {
    return this.labels.ownerInfo();
  }

  /**
   * Spools the label PDF (console): the response is the spool job; its file is downloaded from the spooler once it
   * completed.
   */
  @RequireScopes('inventory:admin', 'spooler:admin')
  @Post('spool')
  @HttpCode(202)
  async spool(@Body() dto: PrintInventoryLabelsDto, @Req() req: RequestWithUser): Promise<SpoolJobResponseDto> {
    return mapSpoolJob(await this.printouts.spoolInventoryLabels(dto, getUserFromRequest(req).userId));
  }

  /** Renders the selected labels into one PDF (synchronous export for API clients; at most 1000 labels). */
  @RequireScopes('inventory:admin')
  @Post()
  @HttpCode(200)
  async print(
    @Body() dto: PrintInventoryLabelsDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, fileName, count } = await this.labels.render(dto);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('X-Label-Count', String(count));

    return new StreamableFile(buffer);
  }
}
