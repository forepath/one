import { Controller, Get, Optional } from '@nestjs/common';

import { ConfigResponseDto } from '../dto/config-response.dto';
import { ConfigService } from '../services/config.service';
import { IsolationCapabilitiesService } from '../services/isolation-capabilities.service';

/**
 * Controller for configuration endpoints.
 * Provides access to configuration parameters.
 */
@Controller('config')
export class ConfigController {
  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly isolationCapabilities?: IsolationCapabilitiesService,
  ) {}

  /**
   * Get configuration parameters.
   * @returns Configuration response DTO including Git repository URL, available agent types and isolation capabilities
   */
  @Get()
  async getConfig(): Promise<ConfigResponseDto> {
    return {
      gitRepositoryUrl: this.configService.getGitRepositoryUrl(),
      gitRepositorySetupMode: this.configService.getGitRepositorySetupMode(),
      agentTypes: this.configService.getAvailableAgentTypes(),
      ...(this.isolationCapabilities ? { isolation: this.isolationCapabilities.getCapabilities() } : {}),
    };
  }
}
