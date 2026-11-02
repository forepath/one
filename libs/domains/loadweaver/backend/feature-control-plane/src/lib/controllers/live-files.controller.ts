import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Delete,
  Get,
  Head,
  Headers,
  HttpCode,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { Response } from 'express';

import type { FileEntry } from '@forepath/loadweaver/shared/util-agent-protocol';
import { LiveFilesService, MAX_FILE_BYTES, parseRange } from '../live/live-files.service';

const TARGET = /^(replica|volume):[a-z0-9_./-]{1,300}$/;

export class LiveFileQueryDto {
  /** `replica:<project/deployment/service/index>` or `volume:<project/deployment/volume>`. */
  @Matches(TARGET)
  target!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  path?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  download?: string;
}

export class CreateLiveFileDto {
  @IsIn(['file', 'directory'])
  type!: 'file' | 'directory';
}

export class MoveLiveFileDto {
  @IsString()
  @MaxLength(4096)
  destination!: string;

  @IsOptional()
  @IsBoolean()
  overwrite?: boolean;
}

/** What a file is, for the browser's preview (Agenstra's `X-File-Type`). */
export function fileType(path: string): 'text' | 'image' | 'video' | 'audio' | 'pdf' | 'binary' {
  const ext = path.split('.').at(-1)?.toLowerCase() ?? '';

  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext)) return 'image';

  if (['mp4', 'webm', 'mov', 'mkv'].includes(ext)) return 'video';

  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) return 'audio';

  if (ext === 'pdf') return 'pdf';

  if (
    [
      'txt',
      'md',
      'json',
      'yaml',
      'yml',
      'toml',
      'ini',
      'conf',
      'cfg',
      'env',
      'xml',
      'html',
      'css',
      'js',
      'ts',
      'sh',
      'py',
      'go',
      'rs',
      'java',
      'sql',
      'log',
      'csv',
    ].includes(ext) ||
    !path.split('/').at(-1)?.includes('.')
  )
    return 'text';

  return 'binary';
}

function warn(res: Response, warning: string | null): void {
  if (warning) res.setHeader('X-Loadweaver-Warning', warning);
}

/**
 * The file browser (3.19), Agenstra's file API: `GET /live/files` lists a directory, `HEAD|GET /live/files/content`
 * reads (with `Range`), `PUT` writes (whole, ≤ 10 MB, or chunks with `Content-Range` and `X-Upload-Id` up to
 * 100 MB), `POST` creates, `DELETE` removes, `PATCH` moves, `POST /live/files/copy` copies.
 */
@Controller('live/files')
export class LiveFilesController {
  constructor(private readonly files: LiveFilesService) {}

  @Get()
  @RequireScopes('live:access')
  async list(@Query() q: LiveFileQueryDto, @Req() req?: RequestWithUser): Promise<FileEntry[]> {
    return await this.files.list(req, q.target, q.path ?? '/');
  }

  @Head('content')
  @RequireScopes('live:access')
  async head(@Query() q: LiveFileQueryDto, @Res() res: Response, @Req() req?: RequestWithUser): Promise<void> {
    const entry = await this.files.stat(req, q.target, q.path ?? '/');

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-File-Type', fileType(q.path ?? ''));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(entry.size));
    res.status(200).end();
  }

  @Get('content')
  @RequireScopes('live:access')
  async read(
    @Query() q: LiveFileQueryDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('range') range?: string,
    @Req() req?: RequestWithUser,
  ): Promise<StreamableFile | undefined> {
    const path = q.path ?? '/';
    const entry = await this.files.stat(req, q.target, path);

    if (entry.type !== 'file') {
      res.status(400);

      return new StreamableFile(Buffer.from('not a file'));
    }

    const parsed = parseRange(range, entry.size);

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-File-Type', fileType(path));
    // Never rendered in the console's origin.
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (q.download === 'true')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${(path.split('/').at(-1) ?? 'file').replace(/[^A-Za-z0-9._-]/g, '_')}"`,
      );

    if (parsed === 'unsatisfiable') {
      res.status(416).setHeader('Content-Range', `bytes */${entry.size}`);

      return undefined;
    }

    if (!parsed && entry.size > MAX_FILE_BYTES) {
      res.status(413);

      return new StreamableFile(Buffer.from('larger than 100 MB: read with Range'));
    }

    const start = parsed?.start ?? 0;
    const end = parsed?.end ?? Math.max(0, entry.size - 1);
    const data = entry.size === 0 ? Buffer.alloc(0) : await this.files.read(req, q.target, path, start, end);

    if (parsed) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${start + data.length - 1}/${entry.size}`);
    }

    return new StreamableFile(data);
  }

  @Put('content')
  @RequireScopes('live:access')
  async write(
    @Query() q: LiveFileQueryDto,
    @Body() body: Buffer,
    @Res({ passthrough: true }) res: Response,
    @Headers('content-range') contentRange?: string,
    @Headers('x-upload-id') uploadId?: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    const result = await this.files.write(
      req,
      q.target,
      q.path ?? '/',
      Buffer.isBuffer(body) ? body : Buffer.alloc(0),
      contentRange,
      uploadId && /^[A-Za-z0-9_-]{1,64}$/.test(uploadId) ? uploadId : undefined,
    );

    warn(res, result.warning);
    res.status(result.complete ? 204 : 202);
  }

  @Post()
  @HttpCode(201)
  @RequireScopes('live:access')
  async create(
    @Query() q: LiveFileQueryDto,
    @Body() dto: CreateLiveFileDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    warn(res, await this.files.create(req, q.target, q.path ?? '/', dto.type));
  }

  @Delete()
  @HttpCode(204)
  @RequireScopes('live:access')
  async remove(
    @Query() q: LiveFileQueryDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    warn(res, await this.files.remove(req, q.target, q.path ?? '/'));
  }

  @Patch()
  @HttpCode(204)
  @RequireScopes('live:access')
  async move(
    @Query() q: LiveFileQueryDto,
    @Body() dto: MoveLiveFileDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    warn(res, await this.files.move(req, q.target, q.path ?? '/', dto.destination, dto.overwrite ?? false, 'move'));
  }

  @Post('copy')
  @HttpCode(204)
  @RequireScopes('live:access')
  async copy(
    @Query() q: LiveFileQueryDto,
    @Body() dto: MoveLiveFileDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    warn(res, await this.files.move(req, q.target, q.path ?? '/', dto.destination, dto.overwrite ?? false, 'copy'));
  }
}
