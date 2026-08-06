import { KeycloakRoles, RequireScopes, UserRole, UsersRoles } from '@forepath/identity/backend';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';

import { MeterResponseDto } from '../dto/meter-response.dto';
import { CreateMeterDto, UpdateMeterDto } from '../dto/meter.dto';
import { MetersRepository } from '../repositories/meters.repository';
import { MeterService } from '../services/meter.service';

@Controller('meters')
@RequireScopes('catalog:write')
export class MetersController {
  constructor(
    private readonly metersRepository: MetersRepository,
    private readonly meterService: MeterService,
  ) {}

  @Get()
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  @RequireScopes('catalog:read')
  async list(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<MeterResponseDto[]> {
    const rows = await this.metersRepository.findAll(limit ?? 10, offset ?? 0);

    return rows.map((row) => this.meterService.mapMeterToResponse(row));
  }

  @Get(':id')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  @RequireScopes('catalog:read')
  async get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<MeterResponseDto> {
    const row = await this.metersRepository.findByIdOrThrow(id);

    return this.meterService.mapMeterToResponse(row);
  }

  @Post()
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async create(@Body() dto: CreateMeterDto): Promise<MeterResponseDto> {
    const row = await this.meterService.createMeter(dto);

    return this.meterService.mapMeterToResponse(row);
  }

  @Post(':id')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateMeterDto,
  ): Promise<MeterResponseDto> {
    const row = await this.meterService.updateMeter(id, dto);

    return this.meterService.mapMeterToResponse(row);
  }

  @Delete(':id')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<void> {
    await this.meterService.deleteMeter(id);
  }
}
