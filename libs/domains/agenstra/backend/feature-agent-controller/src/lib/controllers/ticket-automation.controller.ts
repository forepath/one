import { type RequestWithUser } from '@forepath/identity/backend';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';

import { UpdateTicketAutomationDto } from '../dto/ticket-automation';
import { TicketAutomationService } from '../services/ticket-automation.service';

@Controller('tickets/:ticketId/automation')
export class TicketAutomationController {
  constructor(private readonly ticketAutomationService: TicketAutomationService) {}

  @Get()
  async get(@Param('ticketId', ParseUUIDPipe) ticketId: string, @Req() req?: RequestWithUser) {
    return await this.ticketAutomationService.getAutomation(ticketId, req);
  }

  @Patch()
  async patch(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: UpdateTicketAutomationDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.ticketAutomationService.patchAutomation(ticketId, dto, req);
  }

  @Post('approve')
  @HttpCode(HttpStatus.OK)
  async approve(@Param('ticketId', ParseUUIDPipe) ticketId: string, @Req() req?: RequestWithUser) {
    return await this.ticketAutomationService.approve(ticketId, req);
  }

  @Post('unapprove')
  @HttpCode(HttpStatus.OK)
  async unapprove(@Param('ticketId', ParseUUIDPipe) ticketId: string, @Req() req?: RequestWithUser) {
    return await this.ticketAutomationService.unapprove(ticketId, req);
  }

  @Get('runs')
  async listRuns(@Param('ticketId', ParseUUIDPipe) ticketId: string, @Req() req?: RequestWithUser) {
    return await this.ticketAutomationService.listRuns(ticketId, req);
  }

  @Get('runs/:runId')
  async getRun(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Req() req?: RequestWithUser,
  ) {
    return await this.ticketAutomationService.getRun(ticketId, runId, req);
  }

  @Post('runs/:runId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelRun(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Req() req?: RequestWithUser,
  ) {
    return await this.ticketAutomationService.cancelRun(ticketId, runId, req);
  }
}
