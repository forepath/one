import { Public } from '@forepath/identity/backend';
import { Controller, Get, Header, Param } from '@nestjs/common';
import { StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { InstallService } from '../services/install.service';
import { AGENT_SYSTEMD_UNIT } from '../utils/install-script.utils';

const INSTALL_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

/**
 * Public installer endpoints (3.21). They contain no secrets: joining still needs a join token.
 */
@Controller('install')
@Public()
@Throttle(INSTALL_THROTTLE)
export class InstallController {
  constructor(private readonly install: InstallService) {}

  @Get('install.sh')
  @Header('Content-Type', 'text/x-shellscript; charset=utf-8')
  async script(): Promise<string> {
    return await this.install.script();
  }

  @Get('agent/:arch')
  async agent(@Param('arch') arch: string): Promise<StreamableFile> {
    return await this.install.agentBinary(arch);
  }

  /** WAF module for the ingress (3.6); agents verify its pinned SHA-256. */
  @Get('waf/coraza.wasm')
  async wafModule(): Promise<StreamableFile> {
    return await this.install.wafModule();
  }

  /** GeoIP country database for hosted bind9's DNS steering (3.28); agents verify the SHA-256 from their state. */
  @Get('geoip/country.mmdb')
  async geoip(): Promise<StreamableFile> {
    return await this.install.geoip();
  }

  @Get('loadweaver-agent.service')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  unit(): string {
    return AGENT_SYSTEMD_UNIT;
  }
}
