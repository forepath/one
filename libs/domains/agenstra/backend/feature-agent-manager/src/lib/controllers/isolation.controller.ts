import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';

import type { HostIsolationCapabilitiesDto } from '../dto/container-isolation.dto';
import { IsolationCapabilitiesService } from '../services/isolation-capabilities.service';

/**
 * Container isolation capabilities of this agent manager host.
 */
@Controller('isolation')
export class IsolationController {
  constructor(private readonly isolationCapabilities: IsolationCapabilitiesService) {}

  /**
   * Current isolation capability record (states of `standard` / `sandboxed` / `sandboxed-kvm` / `microvm`, revision,
   * recommendation).
   */
  @Get()
  getCapabilities(): HostIsolationCapabilitiesDto {
    return this.isolationCapabilities.getCapabilities();
  }

  /**
   * Re-probe every isolation level now (joins a running probe; recent results are reused).
   */
  @Post('probe')
  @HttpCode(HttpStatus.OK)
  async probe(): Promise<HostIsolationCapabilitiesDto> {
    return await this.isolationCapabilities.requestProbe();
  }
}
