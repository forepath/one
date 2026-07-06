import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';

import type {
  ImportPresentationDto,
  PaginatedPresentationsResponseDto,
  PresentationResponseDto,
  CreatePresentationDto,
  UpdatePresentationDto,
} from '../dto/presentation.dto';
import { PresentationsService } from '../services/presentations.service';
import { getMarpdownUserFromRequest, type RequestWithUser } from '../utils/marpdown-access.utils';

@Controller('presentations')
export class PresentationsController {
  constructor(private readonly presentationsService: PresentationsService) {}

  @Get()
  async list(
    @Req() req: RequestWithUser,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<PaginatedPresentationsResponseDto> {
    const userInfo = getMarpdownUserFromRequest(req);

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.presentationsService.listForUser(userInfo.userId, limit ?? 10, offset ?? 0);
  }

  @Post()
  async create(@Req() req: RequestWithUser, @Body() dto: CreatePresentationDto): Promise<PresentationResponseDto> {
    const userInfo = getMarpdownUserFromRequest(req);

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.presentationsService.create(userInfo.userId, dto.title, dto.markdown);
  }

  @Get(':id')
  async get(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ): Promise<PresentationResponseDto> {
    return await this.presentationsService.getByIdForUser(getMarpdownUserFromRequest(req), id);
  }

  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
    @Body() dto: UpdatePresentationDto,
  ): Promise<PresentationResponseDto> {
    return await this.presentationsService.update(getMarpdownUserFromRequest(req), id, dto);
  }

  @Post(':id/import')
  async importMarkdown(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
    @Body() dto: ImportPresentationDto,
  ): Promise<PresentationResponseDto> {
    return await this.presentationsService.importMarkdown(getMarpdownUserFromRequest(req), id, dto.markdown);
  }

  @Delete(':id')
  async delete(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: RequestWithUser,
  ): Promise<void> {
    await this.presentationsService.delete(getMarpdownUserFromRequest(req), id);
  }
}
