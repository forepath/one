import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { joinResponseSchema, type JoinResponse } from '@forepath/loadweaver/shared/util-agent-protocol';
import { createCsr, generateKeyPair, generateWireguardKeyPair } from '@forepath/loadweaver/shared/util-pki';
import { generateSealKeyPair } from '@forepath/loadweaver/shared/util-secrets';
import { Injectable, Logger } from '@nestjs/common';

import { ControlPlaneRoleManager } from '../control-plane/control-plane-role.manager';
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
}

export interface BootstrapOptions {
  nodeName: string;
  /** Hostname or IP other nodes reach this one on (control-plane gRPC + WireGuard). */
  publicHost: string;
  clusterName?: string;
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
  ) {}

  async join(options: JoinOptions): Promise<JoinResponse> {
    if (await this.state.credentials()) {
      throw new Error('this node already belongs to a cluster; remove its state before joining another one');
    }

    const url = assertSafeServerUrl(options.server);

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
