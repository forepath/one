import {
  agentMessage,
  decodeControlPlaneMessage,
  openAgentStream,
  type AgentHello,
  type AgentStreamConnection,
  type DesiredState,
  type Envelope,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  createCsr,
  generateKeyPair,
  remainingLifetimeFraction,
  type PemKeyPair,
  wireguardPublicKey,
} from '@forepath/loadweaver/shared/util-pki';
import { openSealed, sealPublicKey, sealTo } from '@forepath/loadweaver/shared/util-secrets';
import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';

import { HostInfoService } from '../host/host-info.service';
import { ReconcilerService } from '../reconciler/reconciler.service';
import { AgentStateStore, type AgentIdentity } from '../state/agent-state.store';
import { SecretBroker } from '../workloads/secret-broker.service';
import { WorkloadIdentityManager } from '../mesh/workload-identity.manager';
import { ImageScanner } from '../images/image-scanner';
import { RegistryRouter } from '../registry/registry-router';
import { ProbeManager } from '../probes/probe.manager';
import { VpnManager } from '../network/vpn.manager';
import { VolumePluginServer } from '../volumes/volume-plugin.server';
import { WorkloadManager } from '../workloads/workload.manager';

export const AGENT_VERSION = process.env['LOADWEAVER_AGENT_VERSION'] || '0.0.0';
const HEARTBEAT_MS = 10_000;
const ROTATION_CHECK_MS = 60 * 60_000;
const ROTATE_BELOW_FRACTION = 1 / 3;
const PREFERENCE_CHECK_MS = 30_000;
const WORKLOAD_STATUS_MS = 15_000;
const MAX_BACKOFF_MS = 30_000;
const GRPC_PORT = Number(process.env['LOADWEAVER_GRPC_PORT'] || 7443);

/**
 * Endpoints in order of preference: control-plane members over the WireGuard overlay first (once a link to
 * them exists, or this node is a member itself), then the endpoints handed out at join time (3.21).
 */
export function preferredEndpoints(identity: AgentIdentity, state: DesiredState | null): string[] {
  const overlay: string[] = [];

  if (state) {
    const linked = new Set(state.network.wireguard.map((l) => l.peer));

    for (const member of state.controlPlane.members) {
      if (member.witness || !member.address) continue;

      if (member.name === identity.nodeName || linked.has(member.name)) {
        overlay.push(`${member.address.includes(':') ? `[${member.address}]` : member.address}:${GRPC_PORT}`);
      }
    }
  }

  return [...new Set([...overlay, ...identity.controlPlaneEndpoints])];
}

interface Session {
  endpoint: string;
  connection: AgentStreamConnection;
  established: boolean;
}

/**
 * The node's one persistent, outbound stream to the control plane (3.19).
 */
@Injectable()
export class AgentConnectionService implements OnApplicationShutdown {
  private readonly logger = new Logger(AgentConnectionService.name);
  private session: Session | null = null;
  private candidate: Session | null = null;
  private timers: NodeJS.Timeout[] = [];
  private stopped = false;
  private backoffMs = 1_000;
  private endpointIndex = 0;
  private lastState: DesiredState | null = null;
  private pendingKey: PemKeyPair | null = null;

  constructor(
    private readonly state: AgentStateStore,
    private readonly hostInfo: HostInfoService,
    private readonly reconciler: ReconcilerService,
    private readonly secrets: SecretBroker,
    private readonly workloads: WorkloadManager,
    private readonly volumePlugin: VolumePluginServer,
    private readonly registryRouter: RegistryRouter,
    private readonly workloadIdentities: WorkloadIdentityManager,
    private readonly imageScanner: ImageScanner,
    private readonly probes: ProbeManager,
    private readonly vpn: VpnManager,
  ) {}

  async start(): Promise<void> {
    this.lastState = await this.state.appliedState();

    if (this.lastState) {
      // Restore the host configuration right away, even before the control plane is reachable (P8).
      void this.reconciler.apply(this.lastState);
    }

    await this.connect();
    this.secrets.attach((envelope) => this.send(envelope));
    this.registryRouter.attach((envelope) => this.send(envelope));
    this.workloadIdentities.attach((envelope) => this.send(envelope));
    this.imageScanner.attach((envelope) => this.send(envelope));
    this.probes.attach((envelope) => this.send(envelope));
    this.vpn.attach((envelope) => this.send(envelope));
    await this.volumePlugin
      .start()
      .catch((error: unknown) =>
        this.logger.warn(`Volume plugin unavailable: ${error instanceof Error ? error.message : String(error)}`),
      );
    this.timers.push(setInterval(() => void this.heartbeat(), HEARTBEAT_MS));
    this.timers.push(setInterval(() => void this.reportWorkloads(), WORKLOAD_STATUS_MS));
    this.timers.push(setInterval(() => void this.checkRotation(), ROTATION_CHECK_MS));
    this.timers.push(setInterval(() => void this.checkPreference(), PREFERENCE_CHECK_MS));
    void this.checkRotation();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    this.timers.forEach((t) => clearInterval(t));
    this.close(this.session);
    this.close(this.candidate);
  }

  private async identity(): Promise<AgentIdentity> {
    const identity = await this.state.identity();

    if (!identity) throw new Error('node has not joined a cluster');

    return identity;
  }

  async hello(): Promise<AgentHello> {
    const identity = await this.identity();
    const wgKey = await this.state.wireguardPrivateKey();
    const sealKey = await this.state.sealPrivateKey();

    if (!wgKey) throw new Error('WireGuard key missing');

    return {
      nodeName: identity.nodeName,
      agentVersion: AGENT_VERSION,
      os: await this.hostInfo.os(),
      capabilities: await this.hostInfo.capabilities(),
      capacity: await this.hostInfo.capacity(),
      wireguardPublicKey: wireguardPublicKey(wgKey),
      ...(identity.endpointHost ? { endpointHost: identity.endpointHost } : {}),
      ...(sealKey ? { sealPublicKey: sealPublicKey(sealKey) } : {}),
      appliedRevision: this.lastState?.revision ?? 0,
    };
  }

  private async open(endpoint: string): Promise<Session> {
    const credentials = await this.state.credentials();

    if (!credentials) throw new Error('node credentials missing');

    const connection = openAgentStream(endpoint, credentials);
    const session: Session = { endpoint, connection, established: false };

    connection.stream.on('data', (envelope: Envelope) => void this.onMessage(session, envelope));
    connection.stream.on('error', (error: Error) => this.onClosed(session, error.message));
    connection.stream.on('end', () => this.onClosed(session, 'stream ended'));
    connection.stream.write(agentMessage('hello', await this.hello()));

    return session;
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.session) return;

    const identity = await this.identity();
    const endpoints = preferredEndpoints(identity, this.lastState);
    const endpoint = endpoints[this.endpointIndex % endpoints.length];

    try {
      this.session = await this.open(endpoint);
    } catch (error) {
      this.logger.warn(`Connecting to ${endpoint} failed: ${error instanceof Error ? error.message : String(error)}`);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;

    const delay = Math.min(this.backoffMs, MAX_BACKOFF_MS) * (0.5 + Math.random() / 2);

    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    this.endpointIndex++;
    setTimeout(() => void this.connect(), delay);
  }

  private onClosed(session: Session, reason: string): void {
    if (session === this.candidate) {
      this.candidate = null;
      this.close(session);

      return;
    }

    if (session !== this.session) return;

    this.logger.warn(`Stream to ${session.endpoint} closed: ${reason}`);
    this.session = null;
    this.close(session);
    this.scheduleReconnect();
  }

  private close(session: Session | null): void {
    if (!session) return;

    try {
      session.connection.stream.end();
    } catch {
      // already closed
    }

    session.connection.client.close();
  }

  private send(envelope: Envelope): void {
    this.session?.connection.stream.write(envelope);
  }

  private async onMessage(session: Session, envelope: Envelope): Promise<void> {
    const decoded = decodeControlPlaneMessage(envelope);

    if (decoded.ok === false) {
      this.logger.warn(`Ignoring message: ${decoded.error}`);

      return;
    }

    const message = decoded.message;

    if (!session.established) {
      session.established = true;
      this.backoffMs = 1_000;

      // Make-before-break (3.21): the new path works, so the old one can go.
      if (session === this.candidate) {
        const old = this.session;

        this.session = session;
        this.candidate = null;
        this.close(old);
        this.logger.log(`Switched control-plane stream to ${session.endpoint}`);
      }
    }

    switch (message.type) {
      case 'desiredState': {
        const report = await this.reconciler.apply(message.payload);

        this.probes.apply(message.payload.probes ?? []);

        if (report.status === 'applied') this.lastState = message.payload;

        this.send(agentMessage('applyReport', report));
        void this.reportWorkloads();
        break;
      }
      case 'certificateIssued': {
        if (!this.pendingKey) break;

        await this.state.saveCredentials({
          privateKeyPem: this.pendingKey.privateKeyPem,
          certificatePem: message.payload.certificatePem,
          caCertificatePem: message.payload.caCertificatePem,
        });
        this.pendingKey = null;
        this.logger.log('Node certificate rotated');
        break;
      }
      case 'unsealShareRequest':
        await this.unsealShare(message.payload);
        break;
      case 'secretValue':
        this.secrets.deliver(message.correlationId, message.payload);
        break;
      case 'workloadIdentities':
        await this.workloadIdentities.deliver(message.payload);
        break;
      case 'registryToken':
        this.registryRouter.deliver(message.payload);
        break;
      case 'error':
        if (message.correlationId) this.secrets.deliver(message.correlationId, null, message.payload.message);

        this.logger.warn(`Control plane: ${message.payload.code}: ${message.payload.message}`);
        break;
    }
  }

  /**
   * Re-encrypts this node's master-key share for the requesting control-plane replica (3.22). The plaintext share
   * exists only in memory here and in the requester.
   */
  private async unsealShare(request: {
    requestId: string;
    keyId: string;
    encryptedShare: string;
    requesterPublicKey: string;
  }): Promise<void> {
    const sealKey = await this.state.sealPrivateKey();
    const identity = await this.identity();

    if (!sealKey) return;

    const share = openSealed(
      sealKey,
      Buffer.from(request.encryptedShare, 'base64'),
      `master-key/${request.keyId}/${identity.nodeName}`,
    );

    try {
      const sealed = sealTo(request.requesterPublicKey, share, `unseal/${request.requestId}`);

      this.send(
        agentMessage('unsealShare', {
          requestId: request.requestId,
          keyId: request.keyId,
          sealedShare: sealed.toString('base64'),
        }),
      );
    } finally {
      share.fill(0);
    }
  }

  private async reportWorkloads(): Promise<void> {
    if (!this.session?.established) return;

    try {
      this.send(agentMessage('workloadStatus', await this.workloads.status()));
    } catch (error) {
      this.logger.warn(`Workload status unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async heartbeat(): Promise<void> {
    if (!this.session?.established) return;

    this.send(
      agentMessage('heartbeat', {
        appliedRevision: this.lastState?.revision ?? 0,
        usage: await this.hostInfo.usage(),
        at: new Date().toISOString(),
      }),
    );
  }

  private async checkRotation(): Promise<void> {
    const credentials = await this.state.credentials();

    if (!credentials || !this.session?.established || this.pendingKey) return;

    if (remainingLifetimeFraction(credentials.certificatePem) > ROTATE_BELOW_FRACTION) return;

    const identity = await this.identity();

    this.pendingKey = await generateKeyPair();
    this.send(agentMessage('renewCertificate', { csrPem: await createCsr(this.pendingKey, identity.nodeName) }));
  }

  private async checkPreference(): Promise<void> {
    if (!this.session?.established || this.candidate || this.stopped) return;

    const preferred = preferredEndpoints(await this.identity(), this.lastState)[0];

    if (!preferred || preferred === this.session.endpoint) return;

    try {
      this.candidate = await this.open(preferred);
    } catch {
      this.candidate = null;
    }
  }
}
