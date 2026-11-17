import { RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import { Body, Controller, Get, HttpCode, Post, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';

import { type InventoryLabelOwnerResponseDto, PrintInventoryLabelsDto } from '../dto/inventory.dto';
import { InventoryLabelsService } from '../services/inventory-labels.service';

@Controller('admin/billing/inventory/labels')
@UsersRoles(UserRole.ADMIN)
export class AdminInventoryLabelsController {
  constructor(private readonly labels: InventoryLabelsService) {}

  /** Company data printed on property stickers (for previews). */
  @RequireScopes('inventory:admin')
  @Get('owner')
  owner(): InventoryLabelOwnerResponseDto {
    return this.labels.ownerInfo();
  }

  /** Renders the selected labels into one PDF (synchronous export; at most 1000 labels). */
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
