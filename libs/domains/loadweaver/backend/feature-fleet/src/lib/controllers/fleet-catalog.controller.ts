import type { IncomingMessage, ServerResponse } from 'node:http';

import { Public, RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { APP_NAME_PATTERN, MAX_PACKAGE_SIZE, SEMVER_PATTERN } from '@forepath/loadweaver/shared/util-app-catalog';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  Res,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { CatalogTakedownDto } from '../dto/fleet.dto';
import { FleetAccessService } from '../services/fleet-access.service';
import {
  FleetCatalogService,
  type FleetCatalogInfoDto,
  type FleetCatalogPackageDto,
  type FleetCatalogTakedownDto,
  type ServedFile,
} from '../services/fleet-catalog.service';
import type { FleetCaller } from '../utils/fleet-access.utils';
import { parsePackageFile } from '../utils/fleet-catalog.utils';

/** Content types an upload may have (the raw `.tar.gz` built by `lw app package`). */
export const CATALOG_UPLOAD_TYPES = ['application/gzip', 'application/x-gzip', 'application/octet-stream'];

const SERVE_THROTTLE = { default: { limit: 300, ttl: 60_000 } };

/** Reads a raw request body up to `limit` bytes (the global JSON parser leaves non-JSON bodies untouched). */
export async function readRawBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();

  if (!CATALOG_UPLOAD_TYPES.includes(type))
    throw new UnsupportedMediaTypeException(`upload the package as ${CATALOG_UPLOAD_TYPES.join(' or ')}`);

  const declared = Number(req.headers['content-length']);

  if (Number.isFinite(declared) && declared > limit)
    throw new PayloadTooLargeException(`packages are at most ${limit} bytes`);

  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;

    size += buffer.length;

    if (size > limit) {
      req.destroy();
      throw new PayloadTooLargeException(`packages are at most ${limit} bytes`);
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

/** Sends a served file with a strong ETag (304 on a match) and the cache policy. */
export function sendServed(
  req: IncomingMessage,
  res: ServerResponse,
  file: ServedFile,
  contentType: string,
  cacheControl: string,
): void {
  const etag = `"${file.etag}"`;

  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const match = req.headers['if-none-match'];

  if (match && match.split(',').some((m) => m.trim() === etag || m.trim() === `W/${etag}`)) {
    res.statusCode = 304;
    res.end();

    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(file.body.length));
  res.end(file.body);
}

function appName(raw: string): string {
  if (!APP_NAME_PATTERN.test(raw)) throw new BadRequestException('invalid app name');

  return raw;
}

function appVersion(raw: string): string {
  if (!SEMVER_PATTERN.test(raw)) throw new BadRequestException('invalid version');

  return raw;
}

/**
 * The fleet's app catalog (P1 app store, 2026-10-31).
 *
 * - Fleet admins: catalog info (URL, key), packages (upload, publish / unpublish, delete), takedowns.
 * - Public (clusters, no user auth; the signatures protect integrity, the catalog lists no secrets):
 *   `GET /api/catalog/key`, `index.yaml`, `index.yaml.sig`, `packages/<app>/<version>.tar.gz` (+ `.sig`, cosign
 *   `sign-blob` format).
 */
@Controller('catalog')
export class FleetCatalogController {
  constructor(
    private readonly access: FleetAccessService,
    private readonly catalog: FleetCatalogService,
  ) {}

  private admin(req: RequestWithUser | undefined): FleetCaller {
    const caller = this.access.caller(req);

    this.access.assertAdmin(caller);

    return caller;
  }

  // ------------------------------------------------------------------------------------------- admin

  @Get()
  @RequireScopes('fleet:admin')
  async info(@Req() req?: RequestWithUser): Promise<FleetCatalogInfoDto> {
    this.admin(req);

    return await this.catalog.info();
  }

  @Get('packages')
  @RequireScopes('fleet:admin')
  async list(@Req() req?: RequestWithUser): Promise<FleetCatalogPackageDto[]> {
    this.admin(req);

    return await this.catalog.list();
  }

  /** Raw `.tar.gz` body (`application/gzip`); `?channel=` (one of the manifest's), `?publish=true`. */
  @Post('packages')
  @RequireScopes('fleet:admin')
  async upload(
    @Req() req: RequestWithUser & IncomingMessage,
    @Query('channel') channel?: string,
    @Query('publish') publish?: string,
  ): Promise<FleetCatalogPackageDto> {
    const caller = this.admin(req);
    const archive = await readRawBody(req, MAX_PACKAGE_SIZE);

    return await this.catalog.upload(caller, archive, {
      channel: channel ?? null,
      publish: publish === 'true' || publish === '1',
    });
  }

  @Post('packages/:app/:version/publish')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('fleet:admin')
  async publish(
    @Param('app') app: string,
    @Param('version') version: string,
    @Req() req?: RequestWithUser,
  ): Promise<FleetCatalogPackageDto> {
    return await this.catalog.publish(this.admin(req), appName(app), appVersion(version));
  }

  @Post('packages/:app/:version/unpublish')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('fleet:admin')
  async unpublish(
    @Param('app') app: string,
    @Param('version') version: string,
    @Req() req?: RequestWithUser,
  ): Promise<FleetCatalogPackageDto> {
    return await this.catalog.unpublish(this.admin(req), appName(app), appVersion(version));
  }

  @Delete('packages/:app/:version')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('fleet:admin')
  async remove(
    @Param('app') app: string,
    @Param('version') version: string,
    @Req() req?: RequestWithUser,
  ): Promise<void> {
    await this.catalog.remove(this.admin(req), appName(app), appVersion(version));
  }

  @Get('takedowns')
  @RequireScopes('fleet:admin')
  async takedowns(@Req() req?: RequestWithUser): Promise<FleetCatalogTakedownDto[]> {
    this.admin(req);

    return await this.catalog.listTakedowns();
  }

  /** Takes an app down (all versions, or `versions`). */
  @Post('apps/:app/takedown')
  @RequireScopes('fleet:admin')
  async takedown(
    @Param('app') app: string,
    @Body() dto: CatalogTakedownDto,
    @Req() req?: RequestWithUser,
  ): Promise<FleetCatalogTakedownDto> {
    return await this.catalog.takedown(this.admin(req), appName(app), {
      versions: dto.versions ?? null,
      reason: dto.reason,
    });
  }

  @Delete('takedowns/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('fleet:admin')
  async lift(@Param('id', new ParseUUIDPipe()) id: string, @Req() req?: RequestWithUser): Promise<void> {
    await this.catalog.liftTakedown(this.admin(req), id);
  }

  // ------------------------------------------------------------------------------------------ public

  /** The catalog key (SPKI PEM) clusters pin. */
  @Get('key')
  @Public()
  @Throttle(SERVE_THROTTLE)
  async key(@Req() req: IncomingMessage, @Res() res: ServerResponse): Promise<void> {
    const pem = Buffer.from(await this.catalog.publicKey(), 'utf8');

    sendServed(
      req,
      res,
      { body: pem, etag: (await this.catalog.signingKey()).kid },
      'text/plain; charset=utf-8',
      'public, max-age=300',
    );
  }

  @Get('index.yaml')
  @Public()
  @Throttle(SERVE_THROTTLE)
  async index(@Req() req: IncomingMessage, @Res() res: ServerResponse): Promise<void> {
    sendServed(req, res, await this.catalog.servedIndex(), 'application/yaml; charset=utf-8', 'public, max-age=60');
  }

  @Get('index.yaml.sig')
  @Public()
  @Throttle(SERVE_THROTTLE)
  async indexSignature(@Req() req: IncomingMessage, @Res() res: ServerResponse): Promise<void> {
    sendServed(req, res, await this.catalog.servedIndexSignature(), 'text/plain; charset=utf-8', 'public, max-age=60');
  }

  /** `<version>.tar.gz` or `<version>.tar.gz.sig` of a published version. */
  @Get('packages/:app/:file')
  @Public()
  @Throttle(SERVE_THROTTLE)
  async package(
    @Param('app') app: string,
    @Param('file') file: string,
    @Req() req: IncomingMessage,
    @Res() res: ServerResponse,
  ): Promise<void> {
    const parsed = parsePackageFile(file);

    if (!APP_NAME_PATTERN.test(app) || !parsed) throw new NotFoundException('package not found');

    const served = await this.catalog.servedPackage(app, parsed.version, parsed.signature);

    sendServed(
      req,
      res,
      served,
      parsed.signature ? 'text/plain; charset=utf-8' : 'application/gzip',
      'public, max-age=300',
    );
  }
}
