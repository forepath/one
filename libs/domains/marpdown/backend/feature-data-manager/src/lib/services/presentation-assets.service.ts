import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import type { AssetContentDto, CreateAssetDto, FileNodeDto, MoveAssetDto, WriteAssetDto } from '../dto/asset.dto';
import type { PresentationEntity } from '../entities/presentation.entity';
import { PresentationAssetEntity } from '../entities/presentation-asset.entity';
import { PresentationAssetsRepository } from '../repositories/presentation-assets.repository';
import { PresentationsRepository } from '../repositories/presentations.repository';
import {
  getBaseName,
  getMaxAssetBytes,
  getParentPath,
  isDirectChild,
  normalizeAssetPath,
  validateAssetMimeType,
} from '../utils/asset-path.utils';
import type { UserInfoFromRequest } from '../utils/marpdown-access.utils';
import { ensurePresentationOwner } from '../utils/presentation-access.utils';

@Injectable()
export class PresentationAssetsService {
  constructor(
    private readonly presentationsRepository: PresentationsRepository,
    private readonly assetsRepository: PresentationAssetsRepository,
  ) {}

  async listDirectory(
    userInfo: UserInfoFromRequest,
    presentationId: string,
    directoryPath?: string,
  ): Promise<FileNodeDto[]> {
    const presentation = await this.loadOwnedPresentation(userInfo, presentationId);
    const parentPath =
      directoryPath && directoryPath !== '.' ? normalizeAssetPath(directoryPath) : null;
    const assets = await this.assetsRepository.findAllByPresentation(presentation.id);

    const nodes = new Map<string, FileNodeDto>();

    for (const asset of assets) {
      if (!isDirectChild(parentPath, asset.path)) {
        continue;
      }

      const name = getBaseName(asset.path);

      nodes.set(asset.path, {
        name,
        path: asset.path,
        type: asset.isDirectory ? 'directory' : 'file',
        size: asset.isDirectory ? undefined : asset.sizeBytes,
        modifiedAt: asset.updatedAt.toISOString(),
      });
    }

    return Array.from(nodes.values()).sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    });
  }

  async readAsset(userInfo: UserInfoFromRequest, presentationId: string, rawPath: string): Promise<AssetContentDto> {
    const presentation = await this.loadOwnedPresentation(userInfo, presentationId);
    const path = normalizeAssetPath(rawPath);
    const asset = await this.assetsRepository.findByPath(presentation.id, path);

    if (!asset || asset.isDirectory) {
      throw new NotFoundException('Asset not found');
    }

    return {
      content: asset.content,
      encoding: 'base64',
      mimeType: asset.mimeType,
      size: asset.sizeBytes,
    };
  }

  async writeAsset(
    userInfo: UserInfoFromRequest,
    presentationId: string,
    rawPath: string,
    dto: WriteAssetDto,
  ): Promise<void> {
    const presentation = await this.loadOwnedPresentation(userInfo, presentationId);
    const path = normalizeAssetPath(rawPath);
    const { base64Content, sizeBytes, mimeType } = this.decodeContent(dto.content, dto.encoding, 'application/octet-stream');

    validateAssetMimeType(mimeType);
    this.assertSize(sizeBytes);

    const existing = await this.assetsRepository.findByPath(presentation.id, path);

    if (existing?.isDirectory) {
      throw new BadRequestException('Path is a directory');
    }

    const entity = existing ?? new PresentationAssetEntity();

    entity.presentationId = presentation.id;
    entity.path = path;
    entity.content = base64Content;
    entity.mimeType = mimeType;
    entity.sizeBytes = sizeBytes;
    entity.isDirectory = false;

    await this.assetsRepository.save(entity);
    await this.ensureParentDirectories(presentation.id, path);
  }

  async createAsset(
    userInfo: UserInfoFromRequest,
    presentationId: string,
    rawPath: string,
    dto: CreateAssetDto,
  ): Promise<void> {
    const presentation = await this.loadOwnedPresentation(userInfo, presentationId);
    const path = normalizeAssetPath(rawPath);
    const existing = await this.assetsRepository.findByPath(presentation.id, path);

    if (existing) {
      throw new ConflictException('Path already exists');
    }

    if (dto.type === 'directory') {
      const directory = new PresentationAssetEntity();

      directory.presentationId = presentation.id;
      directory.path = path;
      directory.content = '';
      directory.mimeType = 'inode/directory';
      directory.sizeBytes = 0;
      directory.isDirectory = true;
      await this.assetsRepository.save(directory);
      await this.ensureParentDirectories(presentation.id, path);

      return;
    }

    const mimeType = dto.mimeType ?? 'application/octet-stream';
    const content = dto.content ?? '';
    const { base64Content, sizeBytes } = this.decodeContent(content, dto.encoding, mimeType);

    validateAssetMimeType(mimeType);
    this.assertSize(sizeBytes);

    const file = new PresentationAssetEntity();

    file.presentationId = presentation.id;
    file.path = path;
    file.content = base64Content;
    file.mimeType = mimeType;
    file.sizeBytes = sizeBytes;
    file.isDirectory = false;
    await this.assetsRepository.save(file);
    await this.ensureParentDirectories(presentation.id, path);
  }

  async moveAsset(
    userInfo: UserInfoFromRequest,
    presentationId: string,
    rawPath: string,
    dto: MoveAssetDto,
  ): Promise<void> {
    const presentation = await this.loadOwnedPresentation(userInfo, presentationId);
    const sourcePath = normalizeAssetPath(rawPath);
    const destinationPath = normalizeAssetPath(dto.destinationPath);
    const asset = await this.assetsRepository.findByPath(presentation.id, sourcePath);

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    const conflict = await this.assetsRepository.findByPath(presentation.id, destinationPath);

    if (conflict) {
      throw new ConflictException('Destination already exists');
    }

    if (asset.isDirectory) {
      const children = await this.assetsRepository.findAllByPresentation(presentation.id);
      const subtree = children.filter(
        (child) => child.path === sourcePath || child.path.startsWith(`${sourcePath}/`),
      );

      for (const child of subtree) {
        const suffix = child.path.slice(sourcePath.length);
        const nextPath = `${destinationPath}${suffix}`;

        child.path = nextPath;
        await this.assetsRepository.save(child);
      }

      return;
    }

    asset.path = destinationPath;
    await this.assetsRepository.save(asset);
    await this.ensureParentDirectories(presentation.id, destinationPath);
  }

  async deleteAsset(userInfo: UserInfoFromRequest, presentationId: string, rawPath: string): Promise<void> {
    const presentation = await this.loadOwnedPresentation(userInfo, presentationId);
    const path = normalizeAssetPath(rawPath);
    const asset = await this.assetsRepository.findByPath(presentation.id, path);

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    if (asset.isDirectory) {
      await this.assetsRepository.deleteByPathPrefix(presentation.id, path);

      return;
    }

    await this.assetsRepository.delete(asset);
  }

  async listAllFilesForExport(presentationId: string): Promise<PresentationAssetEntity[]> {
    const assets = await this.assetsRepository.findAllByPresentation(presentationId);

    return assets.filter((asset) => !asset.isDirectory);
  }

  private async loadOwnedPresentation(userInfo: UserInfoFromRequest, presentationId: string): Promise<PresentationEntity> {
    const presentation = await this.presentationsRepository.findByIdOrThrow(userInfo.userId!, presentationId);

    ensurePresentationOwner(userInfo, presentation);

    return presentation;
  }

  private decodeContent(
    content: string,
    encoding: 'utf-8' | 'base64' | undefined,
    mimeType: string,
  ): { base64Content: string; sizeBytes: number; mimeType: string } {
    if (encoding === 'utf-8') {
      const buffer = Buffer.from(content, 'utf-8');

      return {
        base64Content: buffer.toString('base64'),
        sizeBytes: buffer.length,
        mimeType,
      };
    }

    const buffer = Buffer.from(content, 'base64');

    if (buffer.toString('base64') !== content.replace(/\s/g, '')) {
      throw new BadRequestException('Invalid content encoding');
    }

    return {
      base64Content: content,
      sizeBytes: buffer.length,
      mimeType,
    };
  }

  private assertSize(sizeBytes: number): void {
    if (sizeBytes > getMaxAssetBytes()) {
      throw new BadRequestException('File too large');
    }
  }

  private async ensureParentDirectories(presentationId: string, path: string): Promise<void> {
    let parent = getParentPath(path);

    while (parent) {
      const existing = await this.assetsRepository.findByPath(presentationId, parent);

      if (!existing) {
        const directory = new PresentationAssetEntity();

        directory.presentationId = presentationId;
        directory.path = parent;
        directory.content = '';
        directory.mimeType = 'inode/directory';
        directory.sizeBytes = 0;
        directory.isDirectory = true;
        await this.assetsRepository.save(directory);
      }

      parent = getParentPath(parent);
    }
  }
}
