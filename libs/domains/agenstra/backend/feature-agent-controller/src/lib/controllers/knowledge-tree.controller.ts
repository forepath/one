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
  CreateKnowledgeNodeDto,
  CreateKnowledgeRelationDto,
  KnowledgePromptContextResponseDto,
  ReorderKnowledgeNodeDto,
  UpdateKnowledgeNodeDto,
} from '../dto/knowledge';
import { KnowledgeRelationSourceType } from '../entities/knowledge-node.enums';
import { KnowledgeTreeService } from '../services/knowledge-tree.service';

@Controller('knowledge')
export class KnowledgeTreeController {
  constructor(private readonly knowledgeTreeService: KnowledgeTreeService) {}

  @Get()
  async listByClient(@Query('clientId', ParseUUIDPipe) clientId: string, @Req() req?: RequestWithUser) {
    return await this.knowledgeTreeService.listNodes(clientId, req);
  }

  @Get('tree')
  async getTree(@Query('clientId', ParseUUIDPipe) clientId: string, @Req() req?: RequestWithUser) {
    return await this.knowledgeTreeService.getTree(clientId, req);
  }

  @Get('by-sha')
  async getBySha(
    @Query('clientId', ParseUUIDPipe) clientId: string,
    @Query('sha') sha: string,
    @Req() req?: RequestWithUser,
  ) {
    return await this.knowledgeTreeService.findNodeBySha(clientId, sha, req);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createNode(@Body() dto: CreateKnowledgeNodeDto, @Req() req?: RequestWithUser) {
    return await this.knowledgeTreeService.createNode(dto, req);
  }

  @Post('relations')
  @HttpCode(HttpStatus.CREATED)
  async createRelation(@Body() dto: CreateKnowledgeRelationDto, @Req() req?: RequestWithUser) {
    return await this.knowledgeTreeService.createRelation(dto, req);
  }

  @Get('relations')
  async listRelations(
    @Query('clientId', ParseUUIDPipe) clientId: string,
    @Query('sourceType') sourceType: KnowledgeRelationSourceType,
    @Query('sourceId', ParseUUIDPipe) sourceId: string,
    @Req() req?: RequestWithUser,
  ) {
    return await this.knowledgeTreeService.listRelations(clientId, sourceType, sourceId, req);
  }

  @Delete('relations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRelation(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser) {
    await this.knowledgeTreeService.deleteRelation(id, req);
  }

  @Get('relations/prompt-context')
  async getPromptContexts(
    @Query('clientId', ParseUUIDPipe) clientId: string,
    @Query('sourceType') sourceType: KnowledgeRelationSourceType,
    @Query('sourceId', ParseUUIDPipe) sourceId: string,
    @Req() req?: RequestWithUser,
  ): Promise<KnowledgePromptContextResponseDto> {
    return await this.knowledgeTreeService.collectPromptContextsForSource(clientId, sourceType, sourceId, req);
  }

  @Get(':id')
  async getNode(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser) {
    return await this.knowledgeTreeService.getNode(id, req);
  }

  @Get(':id/activity')
  async listActivity(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Req() req?: RequestWithUser,
  ) {
    return await this.knowledgeTreeService.listPageActivity(id, limit, offset, req);
  }

  @Patch(':id')
  async updateNode(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateKnowledgeNodeDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.knowledgeTreeService.updateNode(id, dto, req);
  }

  @Post(':id/reorder')
  async reorderNode(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderKnowledgeNodeDto,
    @Req() req?: RequestWithUser,
  ) {
    return await this.knowledgeTreeService.reorderNode(id, dto, req);
  }

  @Post(':id/duplicate')
  async duplicateNode(@Param('id', ParseUUIDPipe) id: string, @Req() req?: RequestWithUser) {
    return await this.knowledgeTreeService.duplicateNode(id, req);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteNode(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('releaseExternalSyncMarker') releaseExternalSyncMarkerRaw?: string,
    @Req() req?: RequestWithUser,
  ) {
    const releaseExternalSyncMarker = releaseExternalSyncMarkerRaw === 'true' || releaseExternalSyncMarkerRaw === '1';

    await this.knowledgeTreeService.deleteNode(id, req, releaseExternalSyncMarker);
  }
}
