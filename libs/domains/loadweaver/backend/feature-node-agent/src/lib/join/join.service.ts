import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  joinResponseSchema,
  type DiscoveryReport,
  type JoinResponse,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { createCsr, generateKeyPair, generateWireguardKeyPair } from '@forepath/loadweaver/shared/util-pki';
import { generateSealKeyPair } from '@forepath/loadweaver/shared/util-secrets';
import { Injectable, Logger, Optional } from '@nestjs/common';

import { ControlPlaneRoleManager } from '../control-plane/control-plane-role.manager';
import { DiscoveryService } from '../import/discovery.service';
import { AgentConnectionService } from '../stream/agent-connection.service';
import { AgentStateStore } from '../state/agent-state.store';

export interface JoinOptions {
  /** Control-plane URL, e.g. `https://cp.example.com`. */
  server: string;
  token: string;
  nodeName: string;
  /** Public WireGuard endpoint of this node (hostname or IP); omit behind NAT. */
  endpointHost?: string;
  labels?: Record<string, string>;
  /** `sha256:<hex>` of the cluster CA certificate (DER), pinned like kubeadm's discovery hash. */
  caCertHash?: string;
  /**
   * Join for an import (3.21): read-only discovery first, sent with the join; the node stays pending (no desired
   * state) until its join plan is applied. A former installation's identity is archived, not used.
   */
  discover?: boolean;
}

export interface BootstrapOptions {
  nodeName: string;
  /** Hostname or IP other nodes reach this one on (control-plane gRPC + WireGuard). */
  publicHost: string;
  clusterName?: string;
  /**
   * Public HTTPS URL of the API (`LOADWEAVER_PUBLIC_URL`), e.g. `https://lw.example.com` when a TLS proxy in front of
   * this node serves console and API on one origin (Decabill's `loadweaver` service kind). Also the CORS origin.
   */
  publicUrl?: string;
  /**
   * One-time admin claim token (`--admin-claim-token-file` / `LOADWEAVER_ADMIN_CLAIM_TOKEN`): while the cluster has no
   * account, the first console registration (which becomes the administrator) must present it. Only its SHA-256 is
   * stored (`ADMIN_CLAIM_TOKEN_SHA256` in the control-plane environment). Used by Decabill's Loadweaver Cloud so the
   * first visitor of a freshly provisioned public node can't take the cluster over.
   */
  adminClaimToken?: string;
}

const ADMIN_CLAIM_TOKEN_PATTERN = /^[A-Za-z0-9._~-]{32,256}$/;

/** Validates an admin claim token (32 to 256 URL-safe characters) and returns the SHA-256 the control plane keeps. */
export function adminClaimTokenSha256(value: string): string {
  const token = value.trim();

  if (!ADMIN_CLAIM_TOKEN_PATTERN.test(token)) {
    throw new Error('the admin claim token must be 32 to 256 URL-safe characters');
  }

  return createHash('sha256').update(token, 'utf8').digest('hex');
}

const PUBLIC_URL_PATTERN = /^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;

/** Validates `--public-url` (a plain `https://host[:port]` origin, no path) and strips a trailing slash. */
/**
 * Control-plane environment for `bootstrap --public-url`: the public origin (installer, CORS) and `trust proxy`
 * for loopback peers, since a public URL implies a same-host TLS proxy (nginx → 127.0.0.1:3400) — otherwise every
 * client shares the throttler bucket of `127.0.0.1` (H1).
 */
export function publicUrlEnvironment(publicUrl: string | undefined): Record<string, string> {
  if (!publicUrl) return {};

  return { LOADWEAVER_PUBLIC_URL: publicUrl, CORS_ORIGIN: publicUrl, LOADWEAVER_TRUST_PROXY: 'loopback' };
}

export function normalizeBootstrapPublicUrl(value: string): string {
  const url = value.trim().replace(/\/+$/, '');

  if (!PUBLIC_URL_PATTERN.test(url)) throw new Error('--public-url must be a plain https://host[:port] URL');

  return url;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Joining sends a secret token: only over HTTPS, except to the local control plane during bootstrap. */
export function assertSafeServerUrl(server: string): URL {
  const url = new URL(server);

  if (url.protocol === 'https:') return url;

  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return url;

  throw new Error('the control-plane URL must use https (plain http is only allowed for the local control plane)');
}

export function caHash(caCertificatePem: string): string {
  const der = Buffer.from(caCertificatePem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');

  return `sha256:${createHash('sha256').update(der).digest('hex')}`;
}

export function randomJoinToken(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const lookup = Array.from(randomBytes(12), (b) => alphabet[b % alphabet.length]).join('');

  return `lwj_${lookup}.${randomBytes(32).toString('base64url')}`;
}

function secret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Node join (3.21, join token only, never SSH) and first-node bootstrap (a single node is a full cluster, 3.2).
 */
@Injectable()
export class JoinService {
  private readonly logger = new Logger(JoinService.name);

  constructor(
    private readonly state: AgentStateStore,
    private readonly connection: AgentConnectionService,
    private readonly controlPlane: ControlPlaneRoleManager,
    @Optional() private readonly discovery?: DiscoveryService,
  ) {}

  async join(options: JoinOptions): Promise<JoinResponse> {
    const url = assertSafeServerUrl(options.server);
    let discovery: DiscoveryReport | undefined;

    if (options.discover) {
      if (!this.discovery) throw new Error('discovery is not available in this build');

      // Read-only, before anything is written: the report sees the former installation as it is.
      discovery = await this.discovery.discover();

      if ((await this.state.identity())?.pending)
        throw new Error('this node already waits for its join plan; remove its state to join again');

      if ((await this.state.credentials()) || (await this.state.identity())) {
        const archive = await this.state.archiveFormer(discovery.former?.clusterId);

        this.logger.log(`Former installation archived in ${archive}; the join plan decides what happens to it`);
      }
    } else if (await this.state.credentials()) {
      throw new Error(
        'this node already belongs to a cluster; remove its state before joining another one (or join with --discover)',
      );
    }

    if (!(await this.state.wireguardPrivateKey())) {
      await this.state.saveWireguardPrivateKey(generateWireguardKeyPair().privateKey);
    }

    if (!(await this.state.sealPrivateKey())) {
      await this.state.saveSealPrivateKey(generateSealKeyPair().privateKey);
    }

    await this.state.saveIdentity({
      clusterId: '',
      nodeName: options.nodeName,
      controlPlaneUrl: url.origin,
      controlPlaneEndpoints: [],
      endpointHost: options.endpointHost,
    });

    const keys = await generateKeyPair();
    const res = await fetch(new URL('/api/nodes/join', url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: options.token,
        nodeName: options.nodeName,
        csrPem: await createCsr(keys, options.nodeName),
        hello: await this.connection.hello(),
        ...(options.labels ? { labels: options.labels } : {}),
        ...(discovery ? { discover: true, discovery } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) throw new Error(`join rejected by the control plane (HTTP ${res.status})`);

    const response = joinResponseSchema.parse(await res.json());

    if (options.caCertHash && caHash(response.caCertificatePem) !== options.caCertHash.toLowerCase()) {
      throw new Error('the cluster CA does not match the pinned hash; not trusting this control plane');
    }

    await this.state.saveIdentity({
      clusterId: response.clusterId,
      nodeName: response.nodeName,
      controlPlaneUrl: url.origin,
      controlPlaneEndpoints: response.controlPlaneEndpoints,
      endpointHost: options.endpointHost,
      ...(response.pending ? { pending: true } : {}),
    });
    await this.state.saveCredentials({
      privateKeyPem: keys.privateKeyPem,
      certificatePem: response.certificatePem,
      caCertificatePem: response.caCertificatePem,
    });
    this.logger.log(`Joined cluster ${response.clusterId} as ${response.nodeName}`);

    return response;
  }

  /**
   * Creates a new cluster on this node: generates the control-plane secrets, starts etcd, Postgres and the
   * API locally, then joins with a one-time bootstrap token.
   */
  async bootstrap(options: BootstrapOptions): Promise<JoinResponse> {
    if (await this.state.credentials()) throw new Error('this node already belongs to a cluster');

    const publicUrl = options.publicUrl === undefined ? undefined : normalizeBootstrapPublicUrl(options.publicUrl);
    const adminClaimHash =
      options.adminClaimToken === undefined ? undefined : adminClaimTokenSha256(options.adminClaimToken);
    const clusterId = `lw-${randomBytes(4).toString('hex')}`;
    const bootstrapToken = randomJoinToken();
    const environment: Record<string, string> = {
      DB_USERNAME: 'postgres',
      DB_PASSWORD: secret(),
      DB_DATABASE: 'postgres',
      ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      AUTHENTICATION_METHOD: 'users',
      JWT_SECRET: secret(48),
      STATIC_API_KEY: secret(),
      LOADWEAVER_CLUSTER_ID: clusterId,
      LOADWEAVER_GRPC_HOSTNAMES: `localhost,127.0.0.1,${options.publicHost}`,
      LOADWEAVER_GRPC_ENDPOINTS: `${options.publicHost}:7443`,
      LOADWEAVER_POSTGRES_REPLICATION_PASSWORD: secret(),
      LOADWEAVER_POSTGRES_ADMIN_PASSWORD: secret(),
      ...(options.clusterName ? { LOADWEAVER_CLUSTER_NAME: options.clusterName } : {}),
      ...publicUrlEnvironment(publicUrl),
      ...(adminClaimHash ? { ADMIN_CLAIM_TOKEN_SHA256: adminClaimHash } : {}),
    };

    await this.controlPlane.apply(options.nodeName, '127.0.0.1', {
      role: 'member',
      members: [{ name: options.nodeName, address: '127.0.0.1', witness: false }],
      automaticFailover: false,
      scope: clusterId,
      environment: { ...environment, LOADWEAVER_BOOTSTRAP_JOIN_TOKEN: bootstrapToken },
    });
    await this.waitForApi('http://127.0.0.1:3400/api/health');

    return await this.join({
      server: 'http://127.0.0.1:3400',
      token: bootstrapToken,
      nodeName: options.nodeName,
      endpointHost: options.publicHost,
    });
  }

  private async waitForApi(url: string, timeoutMs = 5 * 60_000): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        if ((await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok) return;
      } catch {
        // not up yet
      }

      await sleep(2_000);
    }

    throw new Error('the local control plane did not become healthy');
  }
}
