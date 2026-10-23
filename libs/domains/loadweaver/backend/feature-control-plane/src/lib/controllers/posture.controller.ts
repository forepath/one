import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { PostureCertificatesService, type CertificateTrustSettings } from '../posture/posture-certificates.service';
import { PostureIntegrationsService, type PostureIntegrationDto } from '../posture/posture-integrations.service';
import type { PosturePluginInfo } from '../remote-access/posture-plugin';

const MATCH_KEYS = ['serial', 'deviceId', 'hostname'];

export class UpdatePostureIntegrationDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Plugin fields; omitted secret fields keep their stored value, an empty string clears a field. */
  @IsOptional()
  @IsObject()
  config?: Record<string, string>;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsIn(MATCH_KEYS, { each: true })
  matchBy?: string[];

  /** The vendor's device user must match the VPN client's owner (default on where the plugin supports it). */
  @IsOptional()
  @IsBoolean()
  requireUserMatch?: boolean;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  intervalMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(10080)
  maxAgeMinutes?: number;
}

export class CreatePostureIntegrationDto extends UpdatePostureIntegrationDto {
  @Matches(/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/)
  name!: string;

  @Matches(/^[a-z0-9][a-z0-9-]{0,62}$/)
  type!: string;
}

export class TestPostureIntegrationDto {
  @Matches(/^[a-z0-9][a-z0-9-]{0,62}$/)
  type!: string;

  @IsObject()
  config!: Record<string, string>;
}

export class CertificateTrustDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(262_144)
  companyCaPem?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(262_144)
  crlPem?: string | null;

  @IsOptional()
  @IsBoolean()
  trustClusterCa?: boolean;

  @IsOptional()
  @IsBoolean()
  requireProof?: boolean;
}

function stringRecord(value: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (!value) return undefined;

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 32)
      .filter(([k, v]) => /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(k) && typeof v === 'string'),
  ) as Record<string, string>;
}

/**
 * Device posture integrations (3.31, cluster settings): MDM / EDR integrations (infra reads, cluster admins write;
 * secrets are write-only), connection tests, manual syncs, and the trust settings for device certificates.
 */
@Controller('posture')
export class PostureController {
  constructor(
    private readonly integrations: PostureIntegrationsService,
    private readonly certificates: PostureCertificatesService,
  ) {}

  @Get('plugins')
  @RequireScopes('cluster:read')
  plugins(): PosturePluginInfo[] {
    return this.integrations.plugins();
  }

  @Get('integrations')
  @RequireScopes('cluster:read')
  async list(@Req() req?: RequestWithUser): Promise<PostureIntegrationDto[]> {
    return await this.integrations.list(req);
  }

  @Post('integrations')
  @RequireScopes('cluster:admin')
  async create(@Body() dto: CreatePostureIntegrationDto, @Req() req?: RequestWithUser): Promise<PostureIntegrationDto> {
    return await this.integrations.create(req, { ...dto, config: stringRecord(dto.config) });
  }

  /** Tests an unsaved configuration. */
  @Post('integrations/test')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('cluster:admin')
  async testUnsaved(
    @Body() dto: TestPostureIntegrationDto,
    @Req() req?: RequestWithUser,
  ): Promise<{ ok: boolean; message: string }> {
    return await this.integrations.test(req, { type: dto.type, config: stringRecord(dto.config) ?? {} });
  }

  @Patch('integrations/:id')
  @RequireScopes('cluster:admin')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePostureIntegrationDto,
    @Req() req?: RequestWithUser,
  ): Promise<PostureIntegrationDto> {
    return await this.integrations.update(req, id, { ...dto, config: stringRecord(dto.config) });
  }

  @Delete('integrations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('cluster:admin')
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @Req() req?: RequestWithUser): Promise<void> {
    await this.integrations.remove(req, id);
  }

  @Post('integrations/:id/test')
  @HttpCode(HttpStatus.OK)
  @RequireScopes('cluster:admin')
  async test(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<{ ok: boolean; message: string }> {
    return await this.integrations.test(req, { id });
  }

  @Post('integrations/:id/sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireScopes('cluster:admin')
  async sync(@Param('id', new ParseUUIDPipe()) id: string, @Req() req?: RequestWithUser): Promise<void> {
    await this.integrations.requestSync(req, id);
  }

  @Get('certificates')
  @RequireScopes('cluster:read')
  async certificateTrust(@Req() req?: RequestWithUser): Promise<CertificateTrustSettings> {
    return await this.certificates.settings(req);
  }

  @Put('certificates')
  @RequireScopes('cluster:admin')
  async updateCertificateTrust(
    @Body() dto: CertificateTrustDto,
    @Req() req?: RequestWithUser,
  ): Promise<CertificateTrustSettings> {
    return await this.certificates.updateSettings(req, dto);
  }
}
