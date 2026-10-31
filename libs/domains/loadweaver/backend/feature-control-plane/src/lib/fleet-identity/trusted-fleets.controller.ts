import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';

import type { FleetIdentityRequest } from './fleet-identity.utils';
import { FLEET_KID_PATTERN, MAX_TRUSTED_FLEET_KEYS } from './fleet-identity.utils';
import { TrustedFleetsService, type FleetIdentityStatusDto, type TrustedFleetDto } from './trusted-fleets.service';

export class TrustedFleetKeyInputDto {
  @IsString()
  @Matches(FLEET_KID_PATTERN)
  kid!: string;

  @IsString()
  @MaxLength(1024)
  publicKey!: string;
}

export class PutTrustedFleetDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_TRUSTED_FLEET_KEYS)
  @ValidateNested({ each: true })
  @Type(() => TrustedFleetKeyInputDto)
  keys!: TrustedFleetKeyInputDto[];
}

/**
 * Trusted fleets (3.24): the fleets whose signed identity claims this cluster accepts, so approvals through a fleet
 * count the real person. Cluster admins. Listing and removing natively only; `PUT` also by a fleet's service user
 * with a cluster-admin credential for its own keys (2026-10-29, automatic trust; proof of possession in the service).
 */
@Controller('trusted-fleets')
export class TrustedFleetsController {
  constructor(private readonly fleets: TrustedFleetsService) {}

  @Get()
  @RequireScopes('cluster:admin')
  async list(@Req() req?: RequestWithUser): Promise<TrustedFleetDto[]> {
    return await this.fleets.list(req);
  }

  /**
   * Creates or replaces a trusted fleet (name + 1–3 Ed25519 public keys by `kid`); a fleet registering itself adds
   * its keys (see {@link TrustedFleetsService.put}).
   */
  @Put(':issuer')
  @RequireScopes('cluster:admin')
  async put(
    @Param('issuer') issuer: string,
    @Body() dto: PutTrustedFleetDto,
    @Req() req?: RequestWithUser,
  ): Promise<TrustedFleetDto> {
    return await this.fleets.put(req, issuer, { name: dto.name, keys: dto.keys.map((k) => ({ ...k })) });
  }

  @Delete(':issuer')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('cluster:admin')
  async remove(@Param('issuer') issuer: string, @Req() req?: RequestWithUser): Promise<void> {
    await this.fleets.remove(req, issuer);
  }
}

/**
 * Feature detection for fleets (3.24): the claim protocol version, this cluster's id (the claims' audience) and
 * whether the request's own claim verified (the fleet's probe; no nonce is used up).
 */
@Controller('fleet-identity')
export class FleetIdentityStatusController {
  constructor(private readonly fleets: TrustedFleetsService) {}

  @Get()
  @RequireScopes('cluster:read')
  async status(@Req() req?: RequestWithUser): Promise<FleetIdentityStatusDto> {
    return await this.fleets.status((req ?? {}) as FleetIdentityRequest);
  }
}
