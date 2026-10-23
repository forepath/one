import {
  agentMessage,
  decodeControlPlaneMessage,
  openAgentStream,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_FEATURES,
  type AgentHello,
  type AgentStreamConnection,
  type DesiredState,
  type Envelope,
  type ProtocolFeature,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import {
  createCsr,
  generateKeyPair,
  remainingLifetimeFraction,
  type PemKeyPair,
  wireguardPublicKey,
} from '@forepath/loadweaver/shared/util-pki';
import { openSealed, sealPublicKey, sealTo } from '@forepath/loadweaver/shared/util-secrets';
import { Injectable, Logger, OnApplicationShutdown, Optional } from '@nestjs/common';

import { HostInfoService, kernelHostname, optionalHostname } from '../host/host-info.service';
import { IsolationProbeService } from '../host/isolation-probe.service';
import { ReconcilerService } from '../reconciler/reconciler.service';
import { AgentStateStore, type AgentIdentity } from '../state/agent-state.store';
import { SecretBroker } from '../workloads/secret-broker.service';
import { WorkloadIdentityManager } from '../mesh/workload-identity.manager';
import { ImageScanner } from '../images/image-scanner';
import { RegistryRouter } from '../registry/registry-router';
import { ProbeManager } from '../probes/probe.manager';
import { VpnManager } from '../network/vpn.manager';
import { LogCollectorsService } from '../logs/log-collectors.service';
import { LogShipper } from '../logs/log-shipper';
import { LiveSessionsService } from '../live/live-sessions.service';
import { MigrationService } from '../migration/migration.service';
import { VmMigrationService } from '../migration/vm-migration.service';
import { UpdatesService } from '../updates/updates.service';

const LIVE_MESSAGES = new Set([
  'execOpen',
  'consoleOpen',
  'execInput',
  'execResize',
  'execClose',
  'fileRequest',
  'tunnelOpen',
  'tunnelData',
  'tunnelClose',
]);
import { MetricsCollectorService } from '../metrics/metrics-collector.service';
import { VolumePluginServer } from '../volumes/volume-plugin.server';
import { WorkloadManager } from '../workloads/workload.manager';
import { BackupService } from '../backups/backup.manager';
import { DiscoveryService } from '../import/discovery.service';
import { ImportExecutor } from '../import/import-executor.service';
import { VmSupport } from '../vm/vm-support.service';

export { AGENT_VERSION } from '../updates/agent-version';
import { AGENT_VERSION } from '../updates/agent-version';
const HEARTBEAT_MS = 10_000;
const ROTATION_CHECK_MS = 60 * 60_000;
const ROTATE_BELOW_FRACTION = 1 / 3;
const PREFERENCE_CHECK_MS = 30_000;
const WORKLOAD_STATUS_MS = 15_000;
const MAX_BACKOFF_MS = 30_000;
const HELLO_TIMEOUT_MS = Number(process.env['LOADWEAVER_HELLO_TIMEOUT_MS'] || 30_000);
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
  /** Features the control plane announced on this stream (`helloAck`); none for control planes before it. */
  controlPlaneFeatures?: ReadonlySet<string>;
}

/** Feature for capability changes on the open stream (`capabilitiesUpdate`). */
const CAPABILITY_UPDATES: ProtocolFeature = 'capability-updates';

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
  /** Joined for an import and not activated yet (3.21): the host stays untouched until the first desired state. */
  private pendingImport = false;

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
    private readonly logShipper: LogShipper,
    private readonly logCollectors: LogCollectorsService,
    private readonly metrics: MetricsCollectorService,
    private readonly live: LiveSessionsService,
    private readonly migrations: MigrationService,
    @Optional() private readonly updates?: UpdatesService,
    @Optional() private readonly backups?: BackupService,
    @Optional() private readonly discovery?: DiscoveryService,
    @Optional() private readonly imports?: ImportExecutor,
    @Optional() private readonly isolation?: IsolationProbeService,
    @Optional() private readonly vms?: VmSupport,
    @Optional() private readonly vmMigrations?: VmMigrationService,
  ) {}

  async start(): Promise<void> {
    this.lastState = await this.state.appliedState();
    this.pendingImport = !this.lastState && !!(await this.state.identity())?.pending;

    if (this.lastState) {
      // Restore the host configuration right away, even before the control plane is reachable (P8).
      void this.reconciler.apply(this.lastState);
    }

    this.migrations.attach((envelope) => this.send(envelope));
    this.vmMigrations?.attach((envelope) => this.send(envelope));
    // Changed isolation probes (3.1): the control plane learns the new levels on the open stream (or a fresh hello).
    this.hostInfo.onChange(() => void this.capabilitiesChanged());
    this.backups?.attach((envelope) => this.send(envelope));
    this.imports?.attach((envelope) => this.send(envelope));
    this.vms?.attach((envelope) => this.send(envelope));

    if (this.pendingImport)
      this.logger.log('Joined for an import: waiting for the join plan, the host stays untouched');
    else await this.prepareHost();

    await this.connect();
    this.secrets.attach((envelope) => this.send(envelope));
    this.registryRouter.attach((envelope) => this.send(envelope));
    this.workloadIdentities.attach((envelope) => this.send(envelope));
    this.imageScanner.attach((envelope) => this.send(envelope));
    this.probes.attach((envelope) => this.send(envelope));
    this.vpn.attach((envelope) => this.send(envelope));
    this.live.attach((envelope) => this.send(envelope));
    this.metrics.attach((envelope) => {
      if (!this.session?.established) return false;

      this.send(envelope);

      return true;
    });
    // Logs wait for an established stream; until then they queue up on the node (3.14).
    this.logShipper.attach((envelope) => {
      if (!this.session?.established) return false;

      this.send(envelope);

      return true;
    });
    this.timers.push(setInterval(() => void this.heartbeat(), HEARTBEAT_MS));
    this.timers.push(setInterval(() => void this.reportWorkloads(), WORKLOAD_STATUS_MS));
    this.timers.push(setInterval(() => void this.checkRotation(), ROTATION_CHECK_MS));
    this.timers.push(setInterval(() => void this.checkPreference(), PREFERENCE_CHECK_MS));
    void this.checkRotation();
  }

  /**
   * Cleans up after a previous agent process and offers the volume plugin. Skipped while the node waits for its join
   * plan (3.21: nothing changes on the host before the plan is approved); runs with the first desired state then.
   */
  private async prepareHost(): Promise<void> {
    // Live sessions of a previous agent process are gone with it: their firewall allowances and helpers too.
    await this.live.reset();
    // Serial collectors of the VMs on this node (boot log ring, 3.35); they follow VM containers from their start.
    await this.live.watchConsoles();
    // Removed VM launchers demote their disks (3.35), so the next primary can promote them.
    await this.vms?.watch();
    // Live-migration sessions of a previous agent process (3.10): commit / abort still find them.
    await this.migrations
      .recover()
      .catch((error: unknown) =>
        this.logger.warn(`Migration sessions not recovered: ${error instanceof Error ? error.message : String(error)}`),
      );
    // QEMU live-migration sessions too (M7.4): their disks stay out of the reconcile until commit / abort.
    await this.vmMigrations
      ?.recover()
      .catch((error: unknown) =>
        this.logger.warn(
          `VM migration sessions not recovered: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    // Backup / restore jobs of a previous agent process died with it (3.20): remove what they left behind.
    await this.backups
      ?.recover()
      .catch((error: unknown) =>
        this.logger.warn(`Backup leftovers not removed: ${error instanceof Error ? error.message : String(error)}`),
      );
    await this.volumePlugin
      .start()
      .catch((error: unknown) =>
        this.logger.warn(`Volume plugin unavailable: ${error instanceof Error ? error.message : String(error)}`),
      );
  }

  /** The join plan activated the node: it is a member from here on. */
  private async leavePending(): Promise<void> {
    if (!this.pendingImport) return;

    this.pendingImport = false;

    const identity = await this.state.identity();

    if (identity?.pending) {
      const rest = { ...identity };

      delete rest.pending;
      await this.state.saveIdentity(rest);
    }

    await this.prepareHost();
    this.logger.log('Node activated by its join plan');
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
      // What this agent speaks (3.26): the control plane only sends fields gated by features listed here.
      protocolVersion: PROTOCOL_VERSION,
      features: [...SUPPORTED_PROTOCOL_FEATURES],
      // DRBD's `on` sections must name this host as `uname -n` does (3.5).
      ...optionalHostname(kernelHostname()),
      // What the node runs (3.26).
      ...(this.updates ? { components: await this.updates.report() } : {}),
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
    connection.stream.on('drain', () => {
      if (session === this.session) this.live.drained();
    });
    connection.stream.write(agentMessage('hello', await this.hello()));
    // A stream that never gets an answer (e.g. opened while the local API was being replaced, found in the DR drill)
    // is given up and opened again instead of waiting forever.
    setTimeout(() => {
      if (!session.established) this.onClosed(session, 'no answer from the control plane');
    }, HELLO_TIMEOUT_MS).unref();

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
    // Nobody is attached to the live sessions anymore (3.19): end shells, helpers and tunnels instead of orphaning them.
    void this.live.closeAll();
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

  /** `false` when the stream's buffer is full (it emits `drain` later); without a stream the envelope is dropped. */
  private send(envelope: Envelope): boolean {
    return this.session?.connection.stream.write(envelope) ?? true;
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
      // Log collection starts with the first connection; lines queue on the node while it is down.
      this.logCollectors.start();

      // Make-before-break (3.21): the new path works, so the old one can go.
      if (session === this.candidate) {
        const old = this.session;

        this.session = session;
        this.candidate = null;
        this.close(old);
        // Sources paused for the old stream continue on the new one.
        this.live.drained();
        this.logger.log(`Switched control-plane stream to ${session.endpoint}`);
      }
    }

    const channel = envelope.channel ?? '';

    if (LIVE_MESSAGES.has(message.type) && !channel) return;

    switch (message.type) {
      // What the control plane speaks on this stream (feature `capability-updates`).
      case 'helloAck':
        session.controlPlaneFeatures = new Set(message.payload.features);
        break;
      case 'desiredState': {
        await this.leavePending();
        this.live.configure(message.payload.liveAccess);

        const report = await this.reconciler.apply(message.payload);

        this.probes.apply(message.payload.probes ?? []);

        if (report.status === 'applied') this.lastState = message.payload;

        // Host settings (3.1): the node spec's KVM opt-out and on-demand isolation probes.
        void this.isolation
          ?.applyHost(message.payload.host)
          .catch((error: unknown) =>
            this.logger.warn(`Host settings: ${error instanceof Error ? error.message : String(error)}`),
          );

        this.send(agentMessage('applyReport', report));
        void this.reportWorkloads();

        // Release components (3.26): confirm a self-update, run host updates / the agent swap once applied.
        if (report.status === 'applied') void this.updates?.afterApply(message.payload);

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
      case 'logAck':
        this.logShipper.ack(message.correlationId, message.payload.ok);
        break;
      // Live sessions (3.19), each on its channel (messages without one are dropped).
      case 'execOpen':
        void this.live.openTerminal(channel, message.payload);
        break;
      // VM consoles (3.35): then the exec data messages on the same channel.
      case 'consoleOpen':
        void this.live.openConsole(channel, message.payload);
        break;
      case 'execInput':
        this.live.input(channel, message.payload.data, message.payload.eof === true);
        break;
      case 'execResize':
        void this.live.resize(channel, message.payload.cols, message.payload.rows);
        break;
      case 'execClose':
        void this.live.closeTerminal(channel);
        break;
      case 'fileRequest':
        void this.live.file(channel, message.payload);
        break;
      case 'tunnelOpen':
        void this.live.openTunnel(channel, message.payload.replica, message.payload.port);
        break;
      case 'tunnelData':
        this.live.tunnelData(channel, message.payload.data);
        break;
      case 'tunnelClose':
        this.live.closeTunnel(channel);
        break;
      // Live migration sessions (3.10), on their channel; progress is reported there (`migrationProgress`).
      case 'migrationPrepare':
      case 'migrationPrecopy':
      case 'migrationFreeze':
      case 'migrationRestore':
      case 'migrationCommit':
      case 'migrationAbort':
        // QEMU sessions (M7.4) share commit / abort with the checkpoint path: whoever owns the session ends it.
        if (
          (message.type === 'migrationCommit' || message.type === 'migrationAbort') &&
          this.vmMigrations?.owns(message.payload.role, message.payload.migration, message.payload.attempt)
        )
          void this.vmMigrations.handle(message.type, message.payload);
        else void this.migrations.handle(message.type, message.payload);
        break;
      // QEMU live migration of VMs (3.35 / M7.4), on the session's channel.
      case 'vmMigrationPrepare':
      case 'vmMigrationStart':
      case 'vmMigrationSwitchover':
        void this.vmMigrations?.handle(message.type, message.payload);
        break;
      // Backups / restores (3.20), on their channel; progress is reported there (`backupProgress`).
      case 'discoveryRequest': {
        // Import (3.21): a fresh, read-only discovery for the wizard.
        if (!this.discovery) break;

        const report = await this.discovery.discover({ ownIdentity: true });

        this.send(agentMessage('discoveryReport', { request: message.payload.request, report }));
        break;
      }
      case 'importStep':
        void this.imports?.handle(message.payload);
        break;
      case 'backupRun':
      case 'restoreRun':
        void this.backups?.handle(message.type, message.payload);
        break;
      // Full VMs (3.35): ACPI reboot / shutdown, reset, re-imaging a stopped VM's disk; outcomes come as events.
      case 'vmPower':
      case 'vmImageImport':
        void this.vms?.handle(message.type, message.payload);
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
      const status = await this.workloads.status();

      this.send(agentMessage('workloadStatus', this.vms ? await this.vms.annotate(status) : status));
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
        // Drift: what runs here outside Loadweaver (3.8).
        foreign: { containers: await this.workloads.foreign().catch(() => []) },
        // Versions and update progress change without a reconnect (3.26).
        ...(this.updates ? { components: await this.updates.report().catch(() => ({})) } : {}),
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

  /**
   * Reports changed capabilities (3.1): on the open stream when the control plane announced `capability-updates`
   * (open live sessions stay), else through a fresh hello on a second stream (`refreshHello`).
   */
  async capabilitiesChanged(): Promise<void> {
    const current = this.session;

    if (!current?.established || this.stopped) return;

    if (current.controlPlaneFeatures?.has(CAPABILITY_UPDATES)) {
      try {
        const capabilities = await this.hostInfo.capabilities();

        // A stream that replaced this one in the meantime started with a fresh hello.
        if (this.session === current && current.established)
          this.send(agentMessage('capabilitiesUpdate', { capabilities }));

        return;
      } catch (error) {
        this.logger.warn(
          `Capabilities not reported on the stream (${error instanceof Error ? error.message : String(error)}); sending a fresh hello`,
        );
      }
    }

    this.refreshHello();
  }

  /**
   * Sends a fresh hello (changed capabilities) without dropping the connection first: a second stream to the same
   * endpoint replaces the current one once the control plane answers (make-before-break, as for preferred endpoints).
   */
  private refreshHello(): void {
    const current = this.session;

    if (!current?.established || this.candidate || this.stopped) return;

    void this.open(current.endpoint).then(
      (session) => {
        this.candidate = session;
      },
      (error: unknown) =>
        this.logger.warn(`Capabilities not refreshed: ${error instanceof Error ? error.message : String(error)}`),
    );
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
