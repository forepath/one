import { RequireScopes, type RequestWithUser } from '@forepath/identity/backend';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Req,
} from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';

import { CertificatesService, type CertificateSummary } from '../acme/certificates.service';
import { actorFromRequest } from '../services/audit-log.service';
import { ClusterAccessService } from '../services/cluster-access.service';
import { NodeNamePipe } from '../utils/name.pipe';

export class UploadCertificateDto {
  @IsString()
  @MaxLength(65_536)
  certificatePem!: string;

  @IsString()
  @MaxLength(16_384)
  privateKeyPem!: string;
}

/**
 * Ingress certificates (3.6): ACME-issued ones are listed with their state; uploaded ones take precedence for the
 * names they cover. Private keys are write-only.
 */
@Controller('certificates')
export class CertificatesController {
  constructor(
    private readonly certificates: CertificatesService,
    private readonly access: ClusterAccessService,
  ) {}

  @Get()
  @RequireScopes('cluster:read')
  async list(@Req() req?: RequestWithUser): Promise<CertificateSummary[]> {
    await this.access.assert(req, 'read');

    return await this.certificates.list();
  }

  @Put(':id')
  @RequireScopes('certificates:write')
  async upload(
    @Param('id', NodeNamePipe) id: string,
    @Body() dto: UploadCertificateDto,
    @Req() req?: RequestWithUser,
  ): Promise<CertificateSummary> {
    await this.access.assert(req, 'infra');

    try {
      return await this.certificates.upload(id, dto.certificatePem, dto.privateKeyPem, actorFromRequest(req));
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'invalid certificate');
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScopes('certificates:write')
  async remove(@Param('id', NodeNamePipe) id: string, @Req() req?: RequestWithUser): Promise<void> {
    await this.access.assert(req, 'infra');

    try {
      await this.certificates.remove(id, actorFromRequest(req));
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'cannot delete');
    }
  }
}
