import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { normalizeAtlassianBaseUrl } from '../context-import/atlassian-rest.util';
import { AtlassianSiteConnectionResponseDto } from '../dto/context-import/atlassian-site-connection-response.dto';
import { CreateAtlassianSiteConnectionDto } from '../dto/context-import/create-atlassian-site-connection.dto';
import { UpdateAtlassianSiteConnectionDto } from '../dto/context-import/update-atlassian-site-connection.dto';
import { AtlassianSiteConnectionEntity } from '../entities/atlassian-site-connection.entity';

@Injectable()
export class AtlassianSiteConnectionService {
  constructor(
    @InjectRepository(AtlassianSiteConnectionEntity)
    private readonly repo: Repository<AtlassianSiteConnectionEntity>,
  ) {}

  /** Maps entity to API DTO; never includes `apiToken` (decrypted only in-process for import HTTP calls). */
  private map(row: AtlassianSiteConnectionEntity): AtlassianSiteConnectionResponseDto {
    return {
      id: row.id,
      label: row.label ?? null,
      baseUrl: row.baseUrl,
      accountEmail: row.accountEmail,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async findAll(limit = 10, offset = 0): Promise<AtlassianSiteConnectionResponseDto[]> {
    const rows = await this.repo.find({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return rows.map((r) => this.map(r));
  }

  async findOne(id: string): Promise<AtlassianSiteConnectionResponseDto> {
    const row = await this.repo.findOne({ where: { id } });

    if (!row) {
      throw new NotFoundException('Connection not found');
    }

    return this.map(row);
  }

  async findEntity(id: string): Promise<AtlassianSiteConnectionEntity | null> {
    return await this.repo.findOne({ where: { id } });
  }

  async create(dto: CreateAtlassianSiteConnectionDto): Promise<AtlassianSiteConnectionResponseDto> {
    const baseUrl = normalizeAtlassianBaseUrl(dto.baseUrl);
    const saved = await this.repo.save(
      this.repo.create({
        label: dto.label ?? null,
        baseUrl,
        accountEmail: dto.accountEmail.trim(),
        apiToken: dto.apiToken,
      }),
    );

    return this.map(saved);
  }

  async update(id: string, dto: UpdateAtlassianSiteConnectionDto): Promise<AtlassianSiteConnectionResponseDto> {
    const row = await this.repo.findOne({ where: { id } });

    if (!row) {
      throw new NotFoundException('Connection not found');
    }

    if (dto.label !== undefined) {
      row.label = dto.label;
    }

    if (dto.baseUrl !== undefined) {
      row.baseUrl = normalizeAtlassianBaseUrl(dto.baseUrl);
    }

    if (dto.accountEmail !== undefined) {
      row.accountEmail = dto.accountEmail.trim();
    }

    if (dto.apiToken !== undefined) {
      row.apiToken = dto.apiToken;
    }

    const saved = await this.repo.save(row);

    return this.map(saved);
  }

  async delete(id: string): Promise<void> {
    const res = await this.repo.delete(id);

    if (!res.affected) {
      throw new NotFoundException('Connection not found');
    }
  }
}
