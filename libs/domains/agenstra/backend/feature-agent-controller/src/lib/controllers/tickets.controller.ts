import { type RequestWithUser } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import {
  ApplyGeneratedBodyDto,
  CreateTicketCommentDto,
  CreateTicketDto,
  MigrateTicketDto,
  StartBodyGenerationSessionDto,
  UpdateTicketDto,
} from '../dto/tickets';
import { TicketStatus } from '../entities/ticket.enums';
import { TicketsService } from '../services/tickets.service';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  async list(
    @Query('clientId', new ParseUUIDPipe({ optional: true })) clientId?: string,
    @Query('status') status?: TicketStatus,
    @Query('parentId') parentIdRaw?: string,
    @Req() req?: RequestWithUser,
  ) {
    let parentId: string | null | undefined;

    if (parentIdRaw === 'null') {
      parentId = null;
    } else if (parentIdRaw !== undefined) {
      parentId = parentIdRaw;
    }

    return await this.ticketsService.listTickets({ clientId, status, parentId }, req);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateTicketDto, @Req() req?: RequestWithUser) {
    return await this.ticketsService.create(dto, req);
  }

  @Get(':id/prototype-prompt')
  async prototypePrompt(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser) {
    return await this.ticketsService.getPrototypePrompt(id, req);
  }

  @Get(':id/comments')
  async listComments(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser) {
    return await this.ticketsService.listComments(id, req);
  }

  @Post(':id/comments')
  async addComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTicketCommentDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.ticketsService.addComment(id, dto, req);
  }

  @Get(':id/activity')
  async listActivity(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Req() req?: RequestWithUser,
  ) {
    return await this.ticketsService.listActivity(id, limit, offset, req);
  }

  @Post(':id/body-generation-sessions')
  async startBodySession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartBodyGenerationSessionDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.ticketsService.startBodyGenerationSession(id, dto, req);
  }

  @Post(':id/apply-generated-body')
  async applyGeneratedBody(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyGeneratedBodyDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.ticketsService.applyGeneratedBody(id, dto, req);
  }

  @Post(':id/migrate')
  async migrate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MigrateTicketDto, @Req() req?: RequestWithUser) {
    return await this.ticketsService.migrateTicket(id, dto, req);
  }

  @Get(':id')
  async getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('includeDescendants') includeDescendants?: string,
    @Req() req?: RequestWithUser,
  ) {
    const include = includeDescendants === 'true' || includeDescendants === '1';

    return await this.ticketsService.findOne(id, include, req);
  }

  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTicketDto, @Req() req?: RequestWithUser) {
    return await this.ticketsService.update(id, dto, req);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('releaseExternalSyncMarker') releaseExternalSyncMarkerRaw?: string,
    @Req() req?: RequestWithUser,
  ) {
    const releaseExternalSyncMarker = releaseExternalSyncMarkerRaw === 'true' || releaseExternalSyncMarkerRaw === '1';

    await this.ticketsService.remove(id, req, releaseExternalSyncMarker);
  }
}
