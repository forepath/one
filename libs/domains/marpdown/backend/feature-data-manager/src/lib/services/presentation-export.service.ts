import { Injectable, InternalServerErrorException, Logger, StreamableFile } from '@nestjs/common';
import { marpCli } from '@marp-team/marp-cli';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ExportFormat, PRESENTATION_MARKDOWN_FILENAME } from '@forepath/marpdown/marpdown/shared';

import type { PresentationEntity } from '../entities/presentation.entity';
import { PresentationsRepository } from '../repositories/presentations.repository';
import { PresentationAssetsService } from './presentation-assets.service';
import type { UserInfoFromRequest } from '../utils/marpdown-access.utils';
import { resolveMarpBrowserPath } from '../utils/marp-browser.utils';
import { ensurePresentationOwner } from '../utils/presentation-access.utils';

@Injectable()
export class PresentationExportService {
  private readonly logger = new Logger(PresentationExportService.name);

  constructor(
    private readonly presentationsRepository: PresentationsRepository,
    private readonly assetsService: PresentationAssetsService,
  ) {}

  async exportPresentation(
    userInfo: UserInfoFromRequest,
    presentationId: string,
    format: ExportFormat,
  ): Promise<StreamableFile> {
    const presentation = await this.presentationsRepository.findByIdOrThrow(userInfo.userId!, presentationId);

    ensurePresentationOwner(userInfo, presentation);

    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marpdown-export-'));

    try {
      await this.materializeWorkspace(workDir, presentation);
      const outputFileName = format === ExportFormat.PDF ? 'export.pdf' : 'export.pptx';
      const outputPath = path.join(workDir, outputFileName);
      const browserPath = resolveMarpBrowserPath();
      const args = [
        path.join(workDir, PRESENTATION_MARKDOWN_FILENAME),
        '--allow-local-files',
        '-o',
        outputPath,
        ...(format === ExportFormat.PDF ? ['--pdf'] : ['--pptx']),
        ...(browserPath ? ['--browser-path', browserPath] : []),
      ];

      const exitCode = await marpCli(args);

      if (exitCode !== 0) {
        throw new InternalServerErrorException('Export failed');
      }

      const buffer = await fs.readFile(outputPath);
      const mimeType =
        format === ExportFormat.PDF
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      const downloadName = `${this.sanitizeFileName(presentation.title)}.${format}`;

      return new StreamableFile(buffer, {
        type: mimeType,
        disposition: `attachment; filename="${downloadName}"`,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(`Export failed for presentation ${presentationId}: ${message}`);
      throw new InternalServerErrorException('Export failed');
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  }

  private async materializeWorkspace(workDir: string, presentation: PresentationEntity): Promise<void> {
    await fs.writeFile(path.join(workDir, PRESENTATION_MARKDOWN_FILENAME), presentation.markdown, 'utf-8');

    const assets = await this.assetsService.listAllFilesForExport(presentation.id);

    for (const asset of assets) {
      const targetPath = path.join(workDir, asset.path);

      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, Buffer.from(asset.content, 'base64'));
    }
  }

  private sanitizeFileName(title: string): string {
    const sanitized = title.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

    return sanitized.length > 0 ? sanitized : 'presentation';
  }
}
