import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { ExternalImportSyncMarkerEntity } from '../entities/external-import-sync-marker.entity';
import { ExternalImportMarkerType } from '../entities/external-import.enums';

@Injectable()
export class ExternalImportSyncMarkerService {
  constructor(
    @InjectRepository(ExternalImportSyncMarkerEntity)
    private readonly markerRepo: Repository<ExternalImportSyncMarkerEntity>,
  ) {}

  async findByLocalTicketId(ticketId: string): Promise<ExternalImportSyncMarkerEntity[]> {
    return await this.markerRepo.find({ where: { localTicketId: ticketId } });
  }

  async findByLocalKnowledgeNodeId(nodeId: string): Promise<ExternalImportSyncMarkerEntity[]> {
    return await this.markerRepo.find({ where: { localKnowledgeNodeId: nodeId } });
  }

  async clearLocalTicketPointers(ticketId: string): Promise<void> {
    await this.markerRepo.update({ localTicketId: ticketId }, { localTicketId: null });
  }

  async clearLocalKnowledgePointers(nodeId: string): Promise<void> {
    await this.markerRepo.update({ localKnowledgeNodeId: nodeId }, { localKnowledgeNodeId: null });
  }

  async deleteMarkersForLocalTicket(ticketId: string): Promise<void> {
    await this.markerRepo.delete({ localTicketId: ticketId });
  }

  async deleteMarkersForLocalKnowledgeNode(nodeId: string): Promise<void> {
    await this.markerRepo.delete({ localKnowledgeNodeId: nodeId });
  }

  async findMarker(
    importConfigId: string,
    externalType: ExternalImportMarkerType,
    externalId: string,
  ): Promise<ExternalImportSyncMarkerEntity | null> {
    return await this.markerRepo.findOne({
      where: { importConfigId, externalType, externalId },
    });
  }

  async saveMarker(row: Partial<ExternalImportSyncMarkerEntity>): Promise<ExternalImportSyncMarkerEntity> {
    return await this.markerRepo.save(this.markerRepo.create(row));
  }

  async upsertMarkerFields(
    importConfigId: string,
    externalType: ExternalImportMarkerType,
    externalId: string,
    fields: Pick<
      ExternalImportSyncMarkerEntity,
      'localTicketId' | 'localKnowledgeNodeId' | 'contentHash' | 'lastImportedAt'
    >,
  ): Promise<ExternalImportSyncMarkerEntity> {
    const existing = await this.findMarker(importConfigId, externalType, externalId);

    if (existing) {
      Object.assign(existing, fields);

      return await this.markerRepo.save(existing);
    }

    return await this.saveMarker({
      importConfigId,
      externalType,
      externalId,
      ...fields,
    });
  }

  async deleteAllForConfig(importConfigId: string): Promise<void> {
    await this.markerRepo.delete({ importConfigId });
  }

  async applyTicketDeleteInTransaction(
    em: EntityManager,
    ticketId: string,
    releaseExternalSyncMarker: boolean,
  ): Promise<void> {
    const mRepo = em.getRepository(ExternalImportSyncMarkerEntity);

    if (releaseExternalSyncMarker) {
      await mRepo.delete({ localTicketId: ticketId });
    } else {
      await mRepo.update({ localTicketId: ticketId }, { localTicketId: null });
    }
  }

  async applyKnowledgeNodeDeleteInTransaction(
    em: EntityManager,
    nodeId: string,
    releaseExternalSyncMarker: boolean,
  ): Promise<void> {
    const mRepo = em.getRepository(ExternalImportSyncMarkerEntity);

    if (releaseExternalSyncMarker) {
      await mRepo.delete({ localKnowledgeNodeId: nodeId });
    } else {
      await mRepo.update({ localKnowledgeNodeId: nodeId }, { localKnowledgeNodeId: null });
    }
  }
}
