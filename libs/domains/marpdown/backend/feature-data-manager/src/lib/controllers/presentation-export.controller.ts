import { Body, Controller, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';

import type { ExportPresentationDto } from '../dto/asset.dto';
import { PresentationExportService } from '../services/presentation-export.service';
import { getMarpdownUserFromRequest, type RequestWithUser } from '../utils/marpdown-access.utils';

@Controller('presentations/:presentationId')
export class PresentationExportController {
  constructor(private readonly exportService: PresentationExportService) {}

  @Post('export')
  async exportPresentation(
    @Param('presentationId', new ParseUUIDPipe({ version: '4' })) presentationId: string,
    @Req() req: RequestWithUser,
    @Body() dto: ExportPresentationDto,
  ) {
    return await this.exportService.exportPresentation(getMarpdownUserFromRequest(req), presentationId, dto.format);
  }
}
