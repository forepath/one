import { getMissingPatScopes, RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';

import {
  AcceptInitiativeArtifactDto,
  ConvertInitiativeFindingDto,
  CreateInitiativeArtifactDto,
  CreateInitiativeDecisionDto,
  CreateInitiativeDto,
  CreateInitiativeFindingDto,
  CreateInitiativeProposalDto,
  CreateInitiativeUnknownDto,
  CreateInitiativeWorkItemDto,
  DecideInitiativeDecisionDto,
  DecideInitiativeProposalDto,
  DecideInitiativeRunDto,
  InitiativeRunMessageDto,
  OverrideRetrospectiveDto,
  PlanInitiativeStoryDto,
  PublishInitiativeArtifactDto,
  ReleaseInitiativeDto,
  ReorderInitiativeWorkItemDto,
  ResolveInitiativeUnknownDto,
  SetInitiativeWorkItemDependenciesDto,
  SetInitiativeWorkItemStatusDto,
  StartInitiativeRunDto,
  StartIterationDto,
  TransferInitiativeDto,
  UpdateInitiativeArtifactDto,
  UpdateInitiativeDto,
  UpdateInitiativeFindingDto,
  UpdateInitiativeWorkItemDto,
} from '../dto/initiatives';
import { InitiativeArtifactsService } from '../services/initiative-artifacts.service';
import { InitiativeBuildService } from '../services/initiative-build.service';
import { InitiativeLearnService } from '../services/initiative-learn.service';
import { InitiativeRunsService } from '../services/initiative-runs.service';
import { InitiativeWorkItemsService } from '../services/initiative-work-items.service';
import { InitiativesService } from '../services/initiatives.service';

/**
 * Initiatives (workspace planning that follows the BMad Method). Workspace access like tickets and knowledge;
 * machine tokens need `initiatives:*` plus the domain scope of every side effect (tickets, knowledge, chats).
 */
@Controller()
export class InitiativesController {
  constructor(
    private readonly initiatives: InitiativesService,
    private readonly artifacts: InitiativeArtifactsService,
    private readonly workItems: InitiativeWorkItemsService,
    private readonly build: InitiativeBuildService,
    private readonly runs: InitiativeRunsService,
    private readonly learn: InitiativeLearnService,
  ) {}

  // --- initiatives ----------------------------------------------------------------------------------------------

  @RequireScopes('initiatives:read')
  @Get('initiatives')
  async list(
    @Query('clientId', ParseUUIDPipe) clientId: string,
    @Query('search') search?: string,
    @Query('state') state?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
    @Req() req?: RequestWithUser,
  ) {
    return await this.initiatives.list(clientId, { search, state, limit, offset }, req);
  }

  @RequireScopes('initiatives:write')
  @Post('initiatives')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateInitiativeDto, @Req() req?: RequestWithUser) {
    return await this.initiatives.create(dto, req);
  }

  @RequireScopes('initiatives:read')
  @Get('initiatives/:id')
  async get(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser) {
    return await this.initiatives.get(id, req);
  }

  @RequireScopes('initiatives:write')
  @Patch('initiatives/:id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInitiativeDto, @Req() req?: RequestWithUser) {
    // Auto release moves tickets (draft → todo): a token needs the ticket write scope to switch it on, like /release.
    if (dto.autoRelease === true && (req?.user?.amr ?? []).includes('pat')) {
      const missing = getMissingPatScopes(req?.user?.scopes ?? [], ['tickets:write']);

      if (missing.length > 0) {
        throw new ForbiddenException(`Insufficient token scope. Missing: ${missing.join(', ')}`);
      }
    }

    const updated = await this.initiatives.update(id, dto, req);

    // Settings (prerequisites, auto release, state) change readiness and the automation gate.
    await this.build.refresh(id);

    return updated;
  }

  @RequireScopes('initiatives:write')
  @Delete('initiatives/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser) {
    await this.initiatives.remove(id, req);
  }

  @RequireScopes('initiatives:write')
  @Post('initiatives/:id/iterations')
  async startIteration(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartIterationDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.initiatives.startIteration(id, dto, req);
  }

  @RequireScopes('initiatives:read')
  @Get('initiatives/:id/overview')
  async overview(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser) {
    return await this.workItems.overview(id, req);
  }

  @RequireScopes('initiatives:read')
  @Get('initiatives/:id/activity')
  async activity(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Req() req?: RequestWithUser,
  ) {
    return await this.initiatives.listActivity(id, limit, offset, req);
  }

  // --- documents ------------------------------------------------------------------------------------------------

  @RequireScopes('initiatives:read')
  @Get('initiatives/:id/artifacts')
  async listArtifacts(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser) {
    return await this.artifacts.list(id, req);
  }

  @RequireScopes('initiatives:write')
  @Post('initiatives/:id/artifacts')
  @HttpCode(HttpStatus.CREATED)
  async createArtifact(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInitiativeArtifactDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.artifacts.create(id, dto, req);
  }

  @RequireScopes('initiatives:read')
  @Get('initiative-artifacts/:artifactId')
  async getArtifact(@Param('artifactId', ParseUUIDPipe) artifactId: string, @Req() req?: RequestWithUser) {
    return await this.artifacts.get(artifactId, req);
  }

  @RequireScopes('initiatives:write')
  @Patch('initiative-artifacts/:artifactId')
  async updateArtifact(
    @Param('artifactId', ParseUUIDPipe) artifactId: string,
    @Body() dto: UpdateInitiativeArtifactDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.artifacts.update(artifactId, dto, req);
  }

  @RequireScopes('initiatives:write')
  @Delete('initiative-artifacts/:artifactId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeArtifact(@Param('artifactId', ParseUUIDPipe) artifactId: string, @Req() req?: RequestWithUser) {
    await this.artifacts.remove(artifactId, req);
  }

  @RequireScopes('initiatives:write')
  @Post('initiative-artifacts/:artifactId/accept')
  async acceptArtifact(
    @Param('artifactId', ParseUUIDPipe) artifactId: string,
    @Body() dto: AcceptInitiativeArtifactDto,
    @Req() req?: RequestWithUser,
  ) {
    const accepted = await this.artifacts.accept(artifactId, dto, req);

    await this.build.refresh(accepted.initiativeId);

    return accepted;
  }

  @RequireScopes('initiatives:read')
  @Get('initiative-artifacts/:artifactId/versions')
  async listVersions(@Param('artifactId', ParseUUIDPipe) artifactId: string, @Req() req?: RequestWithUser) {
    return await this.artifacts.listVersions(artifactId, req);
  }

  @RequireScopes('initiatives:read')
  @Get('initiative-artifacts/:artifactId/versions/:version')
  async getVersion(
    @Param('artifactId', ParseUUIDPipe) artifactId: string,
    @Param('version', ParseIntPipe) version: number,
    @Req() req?: RequestWithUser,
  ) {
    return await this.artifacts.getVersion(artifactId, version, req);
  }

  @RequireScopes('initiatives:write', 'knowledge:write')
  @Post('initiative-artifacts/:artifactId/publish')
  async publishArtifact(
    @Param('artifactId', ParseUUIDPipe) artifactId: string,
    @Body() dto: PublishInitiativeArtifactDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.artifacts.publishToKnowledge(artifactId, dto, req);
  }

  // --- work items -----------------------------------------------------------------------------------------------

  @RequireScopes('initiatives:read')
  @Get('initiatives/:id/work-items')
  async listWorkItems(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser) {
    return await this.workItems.list(id, req);
  }

  @RequireScopes('initiatives:write')
  @Post('initiatives/:id/work-items')
  @HttpCode(HttpStatus.CREATED)
  async createWorkItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInitiativeWorkItemDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.workItems.create(id, dto, req);
  }

  @RequireScopes('initiatives:write')
  @Patch('initiative-work-items/:itemId')
  async updateWorkItem(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateInitiativeWorkItemDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.workItems.update(itemId, dto, req);
  }

  @RequireScopes('initiatives:write')
  @Delete('initiative-work-items/:itemId')
  async removeWorkItem(@Param('itemId', ParseUUIDPipe) itemId: string, @Req() req?: RequestWithUser) {
    return await this.workItems.remove(itemId, req);
  }

  @RequireScopes('initiatives:write')
  @Post('initiative-work-items/:itemId/reorder')
  async reorderWorkItem(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: ReorderInitiativeWorkItemDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.workItems.reorder(itemId, dto, req);
  }

  @RequireScopes('initiatives:write')
  @Put('initiative-work-items/:itemId/dependencies')
  async setDependencies(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: SetInitiativeWorkItemDependenciesDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.workItems.setDependencies(itemId, dto, req);
  }

  /** Done / dropped change the linked ticket too. */
  @RequireScopes('initiatives:write', 'tickets:write')
  @Post('initiative-work-items/:itemId/status')
  async setWorkItemStatus(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: SetInitiativeWorkItemStatusDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.workItems.setStatus(itemId, dto, req);
  }

  @RequireScopes('initiatives:write')
  @Post('initiative-work-items/:itemId/retrospective-verdict')
  async overrideRetrospective(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: OverrideRetrospectiveDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.learn.overrideRetrospective(itemId, dto, req);
  }

  @RequireScopes('initiatives:write', 'agent_chats:write', 'tickets:read')
  @Post('initiative-work-items/:itemId/plan')
  async planStory(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: PlanInitiativeStoryDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.build.planStory(itemId, dto, req);
  }

  @RequireScopes('initiatives:write')
  @Post('initiatives/:id/unknowns')
  @HttpCode(HttpStatus.CREATED)
  async createUnknown(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInitiativeUnknownDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.workItems.createUnknown(id, dto, req);
  }

  @RequireScopes('initiatives:write')
  @Post('initiative-unknowns/:unknownId/resolve')
  async resolveUnknown(
    @Param('unknownId', ParseUUIDPipe) unknownId: string,
    @Body() dto: ResolveInitiativeUnknownDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.workItems.resolveUnknown(unknownId, dto, req);
  }

  @RequireScopes('initiatives:write')
  @Delete('initiative-unknowns/:unknownId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeUnknown(@Param('unknownId', ParseUUIDPipe) unknownId: string, @Req() req?: RequestWithUser) {
    await this.workItems.removeUnknown(unknownId, req);
  }

  // --- build --------------------------------------------------------------------------------------------------

  @RequireScopes('initiatives:write', 'tickets:write')
  @Post('initiatives/:id/transfer')
  async transfer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferInitiativeDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.build.transfer(id, dto, req);
  }

  @RequireScopes('initiatives:write', 'tickets:write')
  @Post('initiatives/:id/release')
  async release(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReleaseInitiativeDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.build.release(id, dto, req);
  }

  /** Ticket board: the initiative story a ticket comes from (prerequisites, automation gate). */
  @RequireScopes('tickets:read', 'initiatives:read')
  @Get('tickets/:ticketId/initiative-link')
  async ticketInitiativeLink(@Param('ticketId', ParseUUIDPipe) ticketId: string, @Req() req?: RequestWithUser) {
    return await this.build.linkForTicket(ticketId, req);
  }

  // --- runs ---------------------------------------------------------------------------------------------------

  @RequireScopes('initiatives:read')
  @Get('initiatives/:id/runs')
  async listRuns(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser) {
    return await this.runs.list(id, req);
  }

  /** A run prompts an environment, like a chat plan. */
  @RequireScopes('initiatives:write', 'agent_chats:write')
  @Post('initiatives/:id/runs')
  @HttpCode(HttpStatus.CREATED)
  async startRun(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartInitiativeRunDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.runs.start(id, dto, req);
  }

  @RequireScopes('initiatives:read')
  @Get('initiative-runs/:runId')
  async getRun(@Param('runId', ParseUUIDPipe) runId: string, @Req() req?: RequestWithUser) {
    return await this.runs.get(runId, req);
  }

  @RequireScopes('initiatives:write', 'agent_chats:write')
  @Post('initiative-runs/:runId/messages')
  async messageRun(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: InitiativeRunMessageDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.runs.message(runId, dto, req);
  }

  @RequireScopes('initiatives:write', 'agent_chats:write')
  @Post('initiative-runs/:runId/retry')
  async retryRun(@Param('runId', ParseUUIDPipe) runId: string, @Req() req?: RequestWithUser) {
    return await this.runs.retry(runId, req);
  }

  @RequireScopes('initiatives:write')
  @Post('initiative-runs/:runId/accept')
  async acceptRun(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: DecideInitiativeRunDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.runs.accept(runId, dto, req);
  }

  @RequireScopes('initiatives:write')
  @Post('initiative-runs/:runId/discard')
  async discardRun(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: DecideInitiativeRunDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.runs.discard(runId, dto, req);
  }

  @RequireScopes('initiatives:write')
  @Post('initiative-runs/:runId/cancel')
  async cancelRun(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: DecideInitiativeRunDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.runs.cancel(runId, dto, req);
  }

  // --- learn & adjust -----------------------------------------------------------------------------------------

  @RequireScopes('initiatives:read')
  @Get('initiatives/:id/findings')
  async listFindings(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('status') status?: string,
    @Req() req?: RequestWithUser,
  ) {
    return await this.learn.listFindings(id, status, req);
  }

  @RequireScopes('initiatives:write')
  @Post('initiatives/:id/findings')
  @HttpCode(HttpStatus.CREATED)
  async createFinding(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInitiativeFindingDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.learn.createFindingByUser(id, dto, req);
  }

  @RequireScopes('initiatives:write')
  @Patch('initiative-findings/:findingId')
  async updateFinding(
    @Param('findingId', ParseUUIDPipe) findingId: string,
    @Body() dto: UpdateInitiativeFindingDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.learn.updateFinding(findingId, dto, req);
  }

  @RequireScopes('initiatives:write')
  @Post('initiative-findings/:findingId/convert')
  async convertFinding(
    @Param('findingId', ParseUUIDPipe) findingId: string,
    @Body() dto: ConvertInitiativeFindingDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.learn.convertFinding(findingId, dto, req);
  }

  @RequireScopes('initiatives:read')
  @Get('initiatives/:id/proposals')
  async listProposals(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('status') status?: string,
    @Req() req?: RequestWithUser,
  ) {
    return await this.learn.listProposals(id, status, req);
  }

  @RequireScopes('initiatives:write')
  @Post('initiatives/:id/proposals')
  @HttpCode(HttpStatus.CREATED)
  async createProposal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInitiativeProposalDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.learn.createProposalByUser(id, dto, req);
  }

  @RequireScopes('initiatives:read')
  @Get('initiative-proposals/:proposalId')
  async getProposal(@Param('proposalId', ParseUUIDPipe) proposalId: string, @Req() req?: RequestWithUser) {
    return await this.learn.getProposal(proposalId, req);
  }

  /** Accepting may update or close linked tickets. */
  @RequireScopes('initiatives:write', 'tickets:write')
  @Post('initiative-proposals/:proposalId/accept')
  async acceptProposal(
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Body() dto: DecideInitiativeProposalDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.learn.acceptProposal(proposalId, dto, req);
  }

  @RequireScopes('initiatives:write')
  @Post('initiative-proposals/:proposalId/reject')
  async rejectProposal(
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Body() dto: DecideInitiativeProposalDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.learn.rejectProposal(proposalId, dto, req);
  }

  @RequireScopes('initiatives:read')
  @Get('initiatives/:id/decisions')
  async listDecisions(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser) {
    return await this.learn.listDecisions(id, req);
  }

  @RequireScopes('initiatives:write')
  @Post('initiatives/:id/decisions')
  @HttpCode(HttpStatus.CREATED)
  async createDecision(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInitiativeDecisionDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.learn.createDecisionByUser(id, dto, req);
  }

  @RequireScopes('initiatives:write')
  @Post('initiative-decisions/:decisionId/decide')
  async decideDecision(
    @Param('decisionId', ParseUUIDPipe) decisionId: string,
    @Body() dto: DecideInitiativeDecisionDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.learn.decideDecision(decisionId, dto, req);
  }
}
