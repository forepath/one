import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { Injectable, NotFoundException, StreamableFile } from '@nestjs/common';

import { buildNodeInstallScript } from '../utils/install-script.utils';
import { ClusterIdentityService } from './cluster-identity.service';

export type AgentArch = 'amd64' | 'arm64';
export const AGENT_ARCHES: readonly AgentArch[] = ['amd64', 'arm64'];

function caCertHash(pem: string): string {
  const der = Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');

  return `sha256:${createHash('sha256').update(der).digest('hex')}`;
}

/**
 * Serves the one-line installer and the node agent binaries of this cluster (3.21, 3.26).
 * Binaries come from `LOADWEAVER_AGENT_BINARY_DIR` (filled from the release bundle), named
 * `loadweaver-agent-linux-<arch>`.
 */
@Injectable()
export class InstallService {
  private readonly checksums = new Map<string, { mtimeMs: number; sha256: string }>();

  constructor(private readonly identity: ClusterIdentityService) {}

  private binaryPath(arch: AgentArch): string | null {
    const dir = process.env.LOADWEAVER_AGENT_BINARY_DIR;

    return dir ? join(dir, `loadweaver-agent-linux-${arch}`) : null;
  }

  private async sha256(arch: AgentArch): Promise<string | undefined> {
    const path = this.binaryPath(arch);

    return path ? await this.fileSha256(path) : undefined;
  }

  /** SHA-256 of a bundle file, cached until it changes. */
  private async fileSha256(path: string): Promise<string | undefined> {
    try {
      const info = await stat(path);
      const cached = this.checksums.get(path);

      if (cached && cached.mtimeMs === info.mtimeMs) return cached.sha256;

      const sha256 = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');

      this.checksums.set(path, { mtimeMs: info.mtimeMs, sha256 });

      return sha256;
    } catch {
      return undefined;
    }
  }

  /**
   * GeoIP country database for DNS steering (3.28): DB-IP Lite from the release bundle (CC BY 4.0, monthly), or the
   * operator's own via `LOADWEAVER_GEOIP_DB`. Served on the public install route like the agent binaries, so it must be
   * a database that may be redistributed (DB-IP Lite: CC BY 4.0); the docs say so.
   */
  private geoipPath(): string | null {
    const dir = process.env.LOADWEAVER_AGENT_BINARY_DIR;

    return process.env.LOADWEAVER_GEOIP_DB || (dir ? join(dir, 'dbip-country-lite.mmdb') : null);
  }

  /** Checksum of the GeoIP database, or null when there is none (geo / latency views are left out then). */
  async geoipDatabase(): Promise<{ sha256: string } | null> {
    const path = this.geoipPath();
    const sha256 = path ? await this.fileSha256(path) : undefined;

    return sha256 ? { sha256 } : null;
  }

  async geoip(): Promise<StreamableFile> {
    const path = this.geoipPath();

    if (!path || !(await stat(path).catch(() => null))) throw new NotFoundException('GeoIP database not available');

    return new StreamableFile(createReadStream(path), {
      type: 'application/octet-stream',
      disposition: 'attachment; filename="country.mmdb"',
    });
  }

  async script(): Promise<string> {
    const url = process.env.LOADWEAVER_PUBLIC_URL?.replace(/\/+$/, '');

    if (!url) throw new NotFoundException('installer not available: LOADWEAVER_PUBLIC_URL is not configured');

    const [amd64, arm64] = await Promise.all(AGENT_ARCHES.map((a) => this.sha256(a)));

    return buildNodeInstallScript({
      controlPlaneUrl: url,
      caCertHash: caCertHash(await this.identity.caCertificate()),
      agentSha256: { amd64, arm64 },
    });
  }

  async wafModule(): Promise<StreamableFile> {
    const dir = process.env.LOADWEAVER_AGENT_BINARY_DIR;
    const path = dir ? join(dir, 'coraza-proxy-wasm.wasm') : null;

    if (!path || !(await stat(path).catch(() => null))) throw new NotFoundException('WAF module not available');

    return new StreamableFile(createReadStream(path), {
      type: 'application/wasm',
      disposition: 'attachment; filename="coraza.wasm"',
    });
  }

  async agentBinary(arch: string): Promise<StreamableFile> {
    if (!AGENT_ARCHES.includes(arch as AgentArch)) throw new NotFoundException('unknown architecture');

    const path = this.binaryPath(arch as AgentArch);

    if (!path || !(await this.sha256(arch as AgentArch))) throw new NotFoundException('agent binary not available');

    return new StreamableFile(createReadStream(path), {
      type: 'application/octet-stream',
      disposition: `attachment; filename="loadweaver-agent-linux-${arch}"`,
    });
  }
}
