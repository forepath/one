import { AuthService, Public } from '@forepath/identity/backend';
import { Controller, Get, Header, Optional, Param } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { InstallService } from '../services/install.service';
import { AGENT_SYSTEMD_UNIT, buildComponentsScript } from '../utils/install-script.utils';

const INSTALL_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

/**
 * Public installer endpoints (3.21). They contain no secrets: joining still needs a join token.
 */
@Controller('install')
@Public()
@Throttle(INSTALL_THROTTLE)
export class InstallController {
  constructor(
    private readonly install: InstallService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  /**
   * Whether the first console registration still needs the one-time admin claim token (`users` authentication with
   * `ADMIN_CLAIM_TOKEN_SHA256`, set by `loadweaver-agent bootstrap --admin-claim-token-file`): true only while no
   * account exists. No secrets; Decabill's Cluster tab polls it to know when to stop showing (and wipe) the token,
   * the console to show the claim-token field. Always false in `api-key` / `keycloak` mode. `claimConfigured` tells
   * whether this instance has the claim at all: only `claimConfigured && !claimRequired` means "claimed" (a member
   * or restore without the hash would otherwise look claimed).
   */
  @Get('claim-status')
  async claimStatus(): Promise<{ claimRequired: boolean; claimConfigured: boolean }> {
    const auth = this.usersAuthService();

    return auth ? await auth.adminClaimStatus() : { claimRequired: false, claimConfigured: false };
  }

  /** The identity `AuthService` exists only with `AUTHENTICATION_METHOD=users` (UsersAuthModule). */
  private usersAuthService(): AuthService | null {
    try {
      return this.moduleRef?.get(AuthService, { strict: false }) ?? null;
    } catch {
      return null;
    }
  }

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

  /**
   * The node components (Docker live-restore, gVisor, WireGuard, nftables, BIRD, keepalived, storage userland) as a
   * standalone, idempotent script: the same steps the installer runs, for a first node that was bootstrapped from a
   * verified release agent (Decabill's `loadweaver` service kind). Secret-free; never restarts Docker.
   */
  @Get('components.sh')
  @Header('Content-Type', 'text/x-shellscript; charset=utf-8')
  components(): string {
    return buildComponentsScript();
  }

  @Get('loadweaver-agent.service')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  unit(): string {
    return AGENT_SYSTEMD_UNIT;
  }
}
