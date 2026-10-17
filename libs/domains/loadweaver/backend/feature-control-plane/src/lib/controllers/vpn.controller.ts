import { RequireInteractiveSession, RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  RemoteAccessService,
  type VpnClientConfigResponse,
  type VpnClientSummary,
} from '../remote-access/remote-access.service';

const DEVICE_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const WIREGUARD_KEY = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$/;

export class EnrollDeviceDto {
  @Matches(DEVICE_NAME)
  name!: string;

  /** Generated on the device; the private key never leaves it. */
  @Matches(WIREGUARD_KEY)
  publicKey!: string;
}

export class RenewDeviceDto {
  @IsOptional()
  @Matches(WIREGUARD_KEY)
  publicKey?: string;
}

export class CreateMachineDto {
  @Matches(DEVICE_NAME)
  name!: string;

  @Matches(WIREGUARD_KEY)
  publicKey!: string;

  @IsArray()
  @ArrayMaxSize(32)
  @Matches(DEVICE_NAME, { each: true })
  groups!: string[];

  /** Office networks behind the machine (site-to-site). */
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(18, { each: true })
  subnets!: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  lifetimeDays?: number;
}

export class RenewMachineDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  lifetimeDays?: number;
}

export class PostureReportDto {
  @IsIn(['macos', 'windows', 'linux', 'ios', 'android'])
  platform!: 'macos' | 'windows' | 'linux' | 'ios' | 'android';

  @Matches(/^[0-9A-Za-z.+-]{1,32}$/)
  osVersion!: string;

  @IsOptional()
  @Matches(/^[0-9A-Za-z.+-]{1,32}$/)
  appVersion?: string;

  @IsOptional()
  @IsBoolean()
  diskEncryption?: boolean;

  @IsOptional()
  @IsBoolean()
  firewall?: boolean;

  @IsOptional()
  @IsBoolean()
  screenLock?: boolean;

  @IsOptional()
  @Matches(/^[0-9A-Za-z._:-]{1,128}$/)
  deviceId?: string;
}

/**
 * Remote access (3.31): users enroll their own devices (self-service, interactive login only), admins add machines
 * and offices, everyone can revoke their own devices instantly, admins anyone's.
 */
@Controller('vpn')
export class VpnController {
  constructor(private readonly remoteAccess: RemoteAccessService) {}

  @Get('devices')
  @RequireScopes('vpn:read')
  async list(@Query('all') all?: string, @Req() req?: RequestWithUser): Promise<VpnClientSummary[]> {
    return await this.remoteAccess.list(req, all === 'true');
  }

  @Post('devices')
  @RequireInteractiveSession()
  async enroll(@Body() dto: EnrollDeviceDto, @Req() req?: RequestWithUser): Promise<VpnClientConfigResponse> {
    return await this.remoteAccess.enroll(req, dto.name, dto.publicKey);
  }

  @Get('devices/:id/config')
  @RequireScopes('vpn:read')
  async config(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req?: RequestWithUser,
  ): Promise<VpnClientConfigResponse> {
    return await this.remoteAccess.config(req, id);
  }

  @Post('devices/:id/renew')
  @RequireInteractiveSession()
  async renew(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RenewDeviceDto,
    @Req() req?: RequestWithUser,
  ): Promise<VpnClientSummary> {
    return await this.remoteAccess.renew(req, id, dto.publicKey);
  }

  @Post('devices/:id/posture')
  @RequireInteractiveSession()
  async posture(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PostureReportDto,
    @Req() req?: RequestWithUser,
  ): Promise<VpnClientSummary> {
    return await this.remoteAccess.reportPosture(req, id, { ...dto });
  }

  @Delete('devices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('vpn:write')
  async revoke(@Param('id', new ParseUUIDPipe()) id: string, @Req() req?: RequestWithUser): Promise<void> {
    await this.remoteAccess.revoke(req, id);
  }

  @Post('machines')
  @RequireScopes('vpn:write')
  async createMachine(@Body() dto: CreateMachineDto, @Req() req?: RequestWithUser): Promise<VpnClientConfigResponse> {
    return await this.remoteAccess.createMachine(req, dto);
  }

  @Post('machines/:id/renew')
  @RequireScopes('vpn:write')
  async renewMachine(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RenewMachineDto,
    @Req() req?: RequestWithUser,
  ): Promise<VpnClientSummary> {
    return await this.remoteAccess.renewMachine(req, id, dto.lifetimeDays);
  }

  @Post('users/:userId/revoke')
  @RequireScopes('vpn:write')
  async revokeUser(@Param('userId') userId: string, @Req() req?: RequestWithUser): Promise<{ revoked: number }> {
    return { revoked: await this.remoteAccess.revokeUser(req, userId.slice(0, 255)) };
  }

  @Get('sessions')
  @RequireScopes('cluster:read')
  async sessions(@Req() req?: RequestWithUser): Promise<VpnClientSummary[]> {
    return await this.remoteAccess.sessions(req);
  }
}
