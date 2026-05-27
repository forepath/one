import { Controller, Get } from '@nestjs/common';

import { ConfigResponseDto } from '../dto/config-response.dto';
import { ConfigService } from '../services/config.service';

/**
 * Controller for configuration endpoints.
 * Provides access to configuration parameters.
 */
@Controller('config')
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Get configuration parameters.
   * @returns Configuration response DTO including Git repository URL and available agent types
   */
  @Get()
  async getConfig(): Promise<ConfigResponseDto> {
    return {
      gitRepositoryUrl: this.configService.getGitRepositoryUrl(),
      gitRepositorySetupMode: this.configService.getGitRepositorySetupMode(),
      agentTypes: this.configService.getAvailableAgentTypes(),
    };
  }
}
