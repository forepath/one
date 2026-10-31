import { randomUUID } from 'node:crypto';

import {
  controlPlaneMessage,
  decodeAgentMessage,
  envelopeForNode,
  GatedFieldRefused,
  KNOWN_PROTOCOL_FEATURES,
  LEGACY_PROTOCOL,
  MAX_ENVELOPE_BYTES,
  negotiate,
  NODE_AGENT_SERVICE,
  PROTOCOL_VERSION,
  type DesiredState,
  type Envelope,
  type FieldGates,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { getQueueRole, shouldRunApiHttp } from '@forepath/shared/backend';
import { Server, ServerCredentials, status, type ServerDuplexStream } from '@grpc/grpc-js';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, QueryFailedError } from 'typeorm';
import type { PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver';

import { memberDatabaseFlag, withPostgresRolePasswords } from '../database-handover/database-handover.utils';
import { databaseTarget } from '../database-handover/database-target.runtime';
import { DEFAULT_GRPC_PORT } from '../constants/control-plane.constants';
import { objectStoreSecrets } from '../object-store/object-store.utils';
import { NodeEntity } from '../entities/node.entity';
import { ClusterIdentityService, derToPem } from '../services/cluster-identity.service';
import { DESIRED_STATE_CHANNEL, NetworkStateService, replicatedEnvironment } from '../services/network-state.service';
import { BackupCommandsService } from '../backups/backup-commands.service';
import { BackupRepositoriesService } from '../backups/backup-repositories.service';
import { ImportControllerService } from '../import/import-controller.service';
import { ImportService } from '../import/import.service';
import { withPlatformBackupSecrets } from '../backups/platform/platform-backups.role';
import { MasterKeyService, UNSEAL_CHANNEL } from '../services/master-key.service';
import { NodeAgentsService } from '../services/node-agents.service';
import { SecretsService } from '../services/secrets.service';
import { NODE_PULL_TOKEN_SECONDS, RegistryTokenService } from '../services/registry-token.service';
import { CertificatesService } from '../acme/certificates.service';
import { bgpResources } from '../bgp/bgp-state.utils';
import { ResourceEntity } from '../entities/resource.entity';
import { PlatformCredentialsService } from '../services/platform-credentials.service';
import { RemoteAccessService } from '../remote-access/remote-access.service';
import { LogsService } from '../logs/logs.service';
import { MetricsStore } from '../metrics/metrics.store';
import { DnsFailoverControllerService } from '../dns/dns-failover-controller.service';
import { dnsProviders } from '../dns/dns.service';
import { DnssecService } from '../dns/dnssec.service';
import { WorkloadIdentityService } from '../mesh/workload-identity.service';
import { ImagePolicyService } from '../images/image-policy.service';
import { AgentSessionRegistry, type AgentSession } from './agent-session.registry';
import { LIVE_FROM_AGENT, LiveBroker, type LiveFromAgent } from '../live/live-broker';
import { MigrationSessionService } from '../services/migration-session.service';
import { MessageBudget } from './message-budget';
import { ListenBackoff } from '../utils/listen-backoff.utils';

const RECONCILE_INTERVAL_MS = 15_000;
const LISTEN_RETRY_MS = 5_000;
const LISTEN_RETRY_MAX_MS = 30_000;
/** At most one refusal event per node, message type and field per minute. */
const REFUSAL_EVENT_INTERVAL_MS = 60_000;

export function readGrpcConfig(env: NodeJS.ProcessEnv = process.env): {
  enabled: boolean;
  port: number;
  hostnames: string[];
} {
  const port = parseInt(env.LOADWEAVER_GRPC_PORT || String(DEFAULT_GRPC_PORT), 10);

  return {
    enabled: (env.LOADWEAVER_GRPC_ENABLED ?? 'true').toLowerCase() !== 'false',
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_GRPC_PORT,
    hostnames: (env.LOADWEAVER_GRPC_HOSTNAMES || 'localhost')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean),
  };
}

/**
 * gRPC endpoint for node agents (3.19): one outbound, mutually authenticated stream per node.
 * Runs on every control-plane replica that serves the API; desired-state changes are announced through
 * Postgres NOTIFY so each replica pushes to the agents connected to it.
 */
/**
 * Adds what must never be persisted in desired-state rows (3.22): the members' shared configuration and the
 * object-store / registry secrets, derived from the cluster's encryption key per generation.
 */
/**
 * The replicated environment as every replica renders it for a member. Each member's agent adds its own overlay
 * address to `LOADWEAVER_GRPC_HOSTNAMES` of its API, so a replica's own value names its member: the members'
 * addresses are taken out again (the receiving agent adds its own), otherwise two replicas push different roles to
 * the same member and its API (and with it the member's containers) flip between them on every reconnect.
 */
export function memberEnvironment(state: DesiredState, env: NodeJS.ProcessEnv): Record<string, string> {
  // Unset Postgres role passwords are derived from the encryption key (user decision 2026-10-30, 3.43).
  const environment = withPostgresRolePasswords(replicatedEnvironment(env), env);
  const hostnames = environment['LOADWEAVER_GRPC_HOSTNAMES'];

  if (hostnames) {
    const members = new Set(state.controlPlane.members.map((m) => m.address));
    const kept = hostnames.split(',').filter((h) => h && !members.has(h));

    if (kept.length) environment['LOADWEAVER_GRPC_HOSTNAMES'] = kept.join(',');
    else delete environment['LOADWEAVER_GRPC_HOSTNAMES'];
  }

  return environment;
}

/**
 * The last desired state of a node that left (3.43): without its control-plane role (the agent removes etcd, Postgres,
 * the log store and its API replica) and `leaving`, one revision above the last, so the agent applies it. Compiles
 * leave left nodes out, so without it the agent kept running its role with the state it had (live 3.43).
 */
export function leftNodeState(state: DesiredState): DesiredState {
  const { members, automaticFailover, scope } = state.controlPlane;

  return {
    ...state,
    revision: state.revision + 1,
    lifecycle: 'leaving',
    controlPlane: { role: 'none', members, automaticFailover, scope },
  };
}

export function withPushSecrets(state: DesiredState, env: NodeJS.ProcessEnv): DesiredState {
  const key = env['ENCRYPTION_KEY'];
  const next: DesiredState =
    state.controlPlane.role === 'member'
      ? { ...state, controlPlane: { ...state.controlPlane, environment: memberEnvironment(state, env) } }
      : { ...state };

  if (!key) return next;

  // Gateway credentials of the member's backup clients (3.20).
  if (next.controlPlane.platformBackups) {
    next.controlPlane = {
      ...next.controlPlane,
      platformBackups: withPlatformBackupSecrets(next.controlPlane.platformBackups, key),
    };
  }

  if (next.objectStore) {
    next.objectStore = {
      generations: next.objectStore.generations.map((g) => {
        const secrets = objectStoreSecrets(key, g.generation);

        return { ...g, rpcSecret: secrets.rpcSecret, adminToken: secrets.adminToken };
      }),
    };
  }

  if (next.registry) {
    const secrets = objectStoreSecrets(key, next.registry.generation);

    next.registry = {
      ...next.registry,
      accessKeyId: secrets.accessKeyId,
      secretAccessKey: secrets.secretAccessKey,
      httpSecret: secrets.registryHttpSecret,
    };
  }

  return next;
}

/** The stream side a session writes to (a grpc-js server duplex stream). */
export interface AgentSessionStream {
  readonly writableEnded: boolean;
  write(envelope: Envelope): unknown;
  end(): void;
}

/**
 * A message the session refused to send (M7 0.1): it carried a refuse-gated field (`isolation`, `devices`, `microvm`,
 * `vm`, block volumes) for a node whose agent lacks the feature. Stripping would silently downgrade the workload, so
 * the whole envelope is dropped; the scheduler keeps such workloads away, so this is a safety net that must not fire.
 */
export interface ProtocolRefusal {
  node: string;
  type: string;
  path: string;
  feature: string;
  at: Date;
}

/** Alert / event kind of a refusal (3.18). */
export const NODE_PROTOCOL_REFUSED = 'node-protocol-refused';

const refusalLogger = new Logger('AgentSession');

/**
 * A node's session on this replica. Every message to the node passes its `send`, which strips the fields the
 * node's negotiated protocol doesn't have (3.26): legacy until the hello, then what the hello advertised. A message
 * with a refuse-gated field the node lacks is logged, reported through `onRefused` and dropped — never sent as a
 * stripped copy. `gates` is for tests.
 */
export function createAgentSession(
  nodeName: string,
  stream: AgentSessionStream,
  gates?: FieldGates,
  onRefused?: (refusal: ProtocolRefusal) => void,
): AgentSession {
  const session: AgentSession = {
    nodeName,
    sessionId: randomUUID(),
    connectedAt: new Date(),
    sentRevision: -1,
    protocol: LEGACY_PROTOCOL,
    send: (envelope) => {
      if (stream.writableEnded) return;

      let gated: Envelope | null;

      try {
        // `null`: a message type the node didn't advertise (e.g. live migration): never sent (3.26).
        gated = envelopeForNode(envelope, session.protocol, gates);
      } catch (error) {
        if (!(error instanceof GatedFieldRefused)) throw error;

        refusalLogger.error(`Agent ${nodeName}: ${error.message}; message dropped (${NODE_PROTOCOL_REFUSED})`);
        onRefused?.({ node: nodeName, type: error.type, path: error.path, feature: error.feature, at: new Date() });

        return;
      }

      if (gated) stream.write(gated);
    },
    close: (reason) => {
      if (!stream.writableEnded) {
        session.send(controlPlaneMessage('error', { code: 'closed', message: reason }));
        stream.end();
      }
    },
  };

  return session;
}

@Injectable()
export class AgentStreamServer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AgentStreamServer.name);
  private server: Server | null = null;
  private reconcileTimer: NodeJS.Timeout | null = null;
  private releaseListener: (() => void) | null = null;
  /** Reconnects of the desired-state LISTEN: back-off, one log line on loss / recovery (3.43 live test). */
  private readonly listenBackoff = new ListenBackoff(
    'Desired-state listener',
    this.logger,
    LISTEN_RETRY_MS,
    LISTEN_RETRY_MAX_MS,
  );
  private stopped = false;
  /** Last recorded refusal per node, message type and path: the desired state is re-sent every reconcile. */
  private readonly refusals = new Map<string, number>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly identity: ClusterIdentityService,
    private readonly agents: NodeAgentsService,
    private readonly network: NetworkStateService,
    private readonly registry: AgentSessionRegistry,
    private readonly masterKey: MasterKeyService,
    private readonly secrets: SecretsService,
    private readonly registryTokens: RegistryTokenService,
    private readonly certificates: CertificatesService,
    private readonly credentials: PlatformCredentialsService,
    private readonly remoteAccess: RemoteAccessService,
    private readonly logs: LogsService,
    private readonly metrics: MetricsStore,
    private readonly failover: DnsFailoverControllerService,
    private readonly dnssec: DnssecService,
    private readonly workloadIdentities: WorkloadIdentityService,
    private readonly imagePolicies: ImagePolicyService,
    private readonly live: LiveBroker,
    private readonly migrations: MigrationSessionService,
    private readonly backupCommands: BackupCommandsService,
    private readonly backupRepositories: BackupRepositoriesService,
    private readonly importController: ImportControllerService,
    private readonly imports: ImportService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const config = readGrpcConfig();

    if (!config.enabled || !shouldRunApiHttp(getQueueRole())) return;

    const keyPair = await this.identity.issueServerCertificate(config.hostnames);
    const credentials = ServerCredentials.createSsl(
      Buffer.from(keyPair.caCertificatePem),
      [{ cert_chain: Buffer.from(keyPair.certificatePem), private_key: Buffer.from(keyPair.privateKeyPem) }],
      true,
    );
    const server = new Server({
      'grpc.max_receive_message_length': MAX_ENVELOPE_BYTES,
      'grpc.max_send_message_length': MAX_ENVELOPE_BYTES,
      'grpc.keepalive_time_ms': 20_000,
    });

    server.addService(NODE_AGENT_SERVICE, {
      connect: (call: ServerDuplexStream<Envelope, Envelope>) => void this.handleConnection(call),
    });
    await new Promise<void>((resolve, reject) =>
      server.bindAsync(`0.0.0.0:${config.port}`, credentials, (error) => (error ? reject(error) : resolve())),
    );
    this.server = server;
    this.logger.log(`Agent stream endpoint listening on :${config.port}`);

    void this.listenForDesiredState();
    this.reconcileTimer = setInterval(() => void this.pushToAll(), RECONCILE_INTERVAL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;

    if (this.reconcileTimer) clearInterval(this.reconcileTimer);

    this.releaseListener?.();
    this.registry.all().forEach((s) => s.close('control plane shutting down'));

    if (this.server) await new Promise<void>((resolve) => this.server?.tryShutdown(() => resolve()));
  }

  /** Authenticates the peer: valid cluster certificate, node identity, known fingerprint, node not removed. */
  async authenticate(call: ServerDuplexStream<Envelope, Envelope>): Promise<string | null> {
    const raw = call.getAuthContext()?.sslPeerCertificate?.raw;

    if (!raw) return null;

    const identity = await this.identity.verifyPeer(derToPem(raw));

    if (!identity || identity.kind !== 'node') return null;

    const node = await this.dataSource.getRepository(NodeEntity).findOne({ where: { name: identity.name } });

    if (!node || node.lifecycle === 'left' || !node.certificateFingerprints.includes(identity.fingerprintSha256))
      return null;

    return node.name;
  }

  private async handleConnection(call: ServerDuplexStream<Envelope, Envelope>): Promise<void> {
    let nodeName: string | null;

    try {
      nodeName = await this.authenticate(call);
    } catch (error) {
      this.logger.warn(`Agent authentication error: ${error instanceof Error ? error.message : String(error)}`);
      nodeName = null;
    }

    if (!nodeName) {
      call.emit('error', { code: status.UNAUTHENTICATED, details: 'unauthenticated' });
      call.end();

      return;
    }

    const name = nodeName;
    const budget = new MessageBudget();
    let queue: Promise<void> = Promise.resolve();
    const session = createAgentSession(name, call, undefined, (refusal) => this.protocolRefused(refusal));

    this.registry.register(session);
    // Live sessions for this node are relayed to this replica (3.19).
    void this.live.owned(name).catch(() => undefined);
    this.logger.log(`Agent ${name} connected`);

    call.on('data', (envelope: Envelope) => {
      if (!budget.allow((LIVE_FROM_AGENT as readonly string[]).includes(envelope.type))) {
        session.close('message rate exceeded');

        return;
      }

      // Messages of one node are handled strictly in order.
      queue = queue
        .then(() => this.dispatch(session, envelope))
        .catch((error: unknown) => {
          this.logger.warn(`Agent ${name}: ${error instanceof Error ? error.message : String(error)}`);
          session.send(
            controlPlaneMessage(
              'error',
              { code: 'rejected', message: 'message rejected' },
              { correlationId: envelope.id },
            ),
          );
        });
    });

    const cleanup = () => {
      this.registry.unregister(session);
      void this.live.released(name).catch(() => undefined);
      void this.agents.markDisconnected(name).catch(() => undefined);
    };

    call.on('end', () => {
      cleanup();
      call.end();
    });
    call.on('error', cleanup);
    call.on('close', cleanup);
  }

  /** A refused message (M7 0.1) becomes an event the `node-protocol-refused` alert fires on (all replicas see it). */
  private protocolRefused(refusal: ProtocolRefusal): void {
    const key = `${refusal.node}\0${refusal.type}\0${refusal.path}`;
    const last = this.refusals.get(key) ?? 0;

    if (refusal.at.getTime() - last < REFUSAL_EVENT_INTERVAL_MS) return;

    this.refusals.set(key, refusal.at.getTime());
    void this.metrics
      .event(
        NODE_PROTOCOL_REFUSED,
        `${refusal.type} to ${refusal.node} not sent: ${refusal.path} needs the agent feature ${refusal.feature}`,
        { entity: refusal.node, data: { type: refusal.type, path: refusal.path, feature: refusal.feature } },
      )
      .catch(() => undefined);
  }

  private async dispatch(session: AgentSession, envelope: Envelope): Promise<void> {
    const decoded = decodeAgentMessage(envelope);

    if (decoded.ok === false) throw new Error(decoded.error);

    const message = decoded.message;

    // Live sessions (3.19): output, exits, file responses and tunnel data go to the session's broker channel.
    if ((LIVE_FROM_AGENT as readonly string[]).includes(message.type)) {
      this.live.fromAgent(
        session.nodeName,
        envelope,
        message.type as LiveFromAgent,
        message.payload as Record<string, unknown>,
      );

      return;
    }

    switch (message.type) {
      case 'hello':
        session.protocol = negotiate(message.payload);
        session.negotiated = true;

        try {
          await this.agents.handleHello(session.nodeName, message.payload);
        } catch (error) {
          // A database that can't take writes right now (e.g. the primary is read-only while the control plane loses
          // and regains its quorum) mustn't keep a member from its role: a new member has to start its etcd before
          // the cluster can write again. Its compiled desired state is pushed anyway; the hello is recorded with the
          // next one. Anything else (e.g. a name that doesn't match the certificate) still ends the session.
          if (!(error instanceof QueryFailedError)) throw error;

          this.logger.warn(
            `Hello of ${session.nodeName} not recorded (${error.message}); pushing its desired state anyway`,
          );
        }

        // What this control plane speaks (feature `capability-updates`; dropped for agents without it): the agent
        // then reports changed capabilities on this stream instead of a fresh hello on a second one.
        session.send(
          controlPlaneMessage(
            'helloAck',
            { protocolVersion: PROTOCOL_VERSION, features: [...KNOWN_PROTOCOL_FEATURES] },
            { correlationId: message.id },
          ),
        );
        session.sentRevision = -1;
        await this.pushDesiredState(session);
        break;
      // Changed isolation probes (M7): the node's capabilities, without replacing the session (live sessions stay).
      case 'capabilitiesUpdate':
        await this.agents.handleCapabilitiesUpdate(session.nodeName, message.payload);
        break;
      case 'heartbeat':
        if (!(await this.agents.handleHeartbeat(session.nodeName, message.payload))) await this.farewell(session);
        break;
      case 'applyReport':
        await this.agents.handleApplyReport(session.nodeName, message.payload);
        break;
      case 'metrics':
        await this.metrics.ingest(session.nodeName, message.payload);
        break;
      case 'logBatch': {
        // Confirmed only once stored: otherwise the node keeps the batch and sends it again (3.14).
        const stored = await this.logs.ingest(session.nodeName, message.payload).then(
          (r) => r.stored,
          () => false,
        );

        session.send(controlPlaneMessage('logAck', { ok: stored }, { correlationId: message.id }));
        break;
      }
      case 'vpnSessions':
        if (!(await this.remoteAccess.recordSessions(session.nodeName, message.payload)))
          this.logger.warn(`VPN sessions from ${session.nodeName}, which is not the active gateway, ignored`);
        break;
      case 'imageScan':
        if (!(await this.imagePolicies.record(session.nodeName, message.payload)))
          this.logger.warn(`Image scan from ${session.nodeName} for an image it doesn't run ignored`);
        break;
      case 'workloadIdentityRequest':
        session.send(
          controlPlaneMessage(
            'workloadIdentities',
            await this.workloadIdentities.issue(session.nodeName, message.payload),
            {
              correlationId: message.id,
            },
          ),
        );
        break;
      case 'renewCertificate': {
        const issued = await this.agents.renewCertificate(session.nodeName, message.payload.csrPem);

        session.send(controlPlaneMessage('certificateIssued', issued, { correlationId: message.id }));
        break;
      }
      case 'event':
        this.agents.handleEvent(session.nodeName, message.payload);
        break;
      case 'workloadStatus':
        await this.agents.handleWorkloadStatus(session.nodeName, message.payload);
        break;
      case 'unsealShare':
        await this.masterKey.accept(session.nodeName, message.payload);
        break;
      case 'secretRequest': {
        try {
          const secret = await this.secrets.valueForNode(
            session.nodeName,
            message.payload.workload,
            message.payload.ref,
          );

          session.send(
            controlPlaneMessage(
              'secretValue',
              {
                workload: message.payload.workload,
                ref: message.payload.ref,
                version: secret.version,
                valueBase64: secret.value.toString('base64'),
              },
              { correlationId: message.id },
            ),
          );
          secret.value.fill(0);
        } catch (error) {
          // The node learns only that it was refused; details stay in the control-plane log.
          this.logger.warn(
            `Secret request from ${session.nodeName} refused: ${error instanceof Error ? error.message : String(error)}`,
          );
          session.send(
            controlPlaneMessage(
              'error',
              { code: 'secret-refused', message: 'secret request refused' },
              { correlationId: message.id },
            ),
          );
        }

        break;
      }
      case 'registryTokenRequest': {
        const { requestId, repositories } = message.payload;

        try {
          const token = await this.registryTokens.issueForNode(session.nodeName, repositories);

          session.send(
            controlPlaneMessage(
              'registryToken',
              { requestId, token, expiresInSeconds: NODE_PULL_TOKEN_SECONDS },
              { correlationId: message.id },
            ),
          );
        } catch (error) {
          this.logger.warn(
            `Registry token for ${session.nodeName} refused: ${error instanceof Error ? error.message : String(error)}`,
          );
          session.send(
            controlPlaneMessage(
              'registryToken',
              { requestId, error: 'pull token refused' },
              { correlationId: message.id },
            ),
          );
        }

        break;
      }
      case 'migrationProgress':
        // Live migration (3.10): only the attempt's source / target, on the session's channel.
        if (!(await this.migrations.recordProgress(session.nodeName, message.payload, envelope.channel)))
          this.logger.warn(`Migration progress from ${session.nodeName} for an unknown or foreign attempt ignored`);
        break;
      case 'backupProgress':
        // Backups / restores (3.20): only on the operation's channel, only from the node it runs on.
        if (!(await this.backupCommands.recordProgress(session.nodeName, message.payload, envelope.channel)))
          this.logger.warn(`Backup progress from ${session.nodeName} for an unknown or foreign operation ignored`);
        break;
      case 'importProgress':
        // Join plans (3.21): only on the import's channel, only from the node it imports.
        if (!(await this.importController.recordProgress(session.nodeName, message.payload, envelope.channel)))
          this.logger.warn(`Import progress from ${session.nodeName} for an unknown or foreign import ignored`);
        break;
      case 'discoveryReport':
        // A fresh discovery of a pending node (3.21): only the answer to the outstanding request.
        if (!(await this.imports.recordDiscovery(session.nodeName, message.payload)))
          this.logger.warn(`Unrequested discovery report from ${session.nodeName} ignored`);
        break;
      case 'probeResults': {
        // Only results for probes this node was given count (3.28).
        const assigned = new Set(
          ((await this.network.getDesiredState(session.nodeName))?.probes ?? []).map((p) => p.id),
        );

        await this.failover.record(session.nodeName, assigned, message.payload.results);
        break;
      }
      case 'error':
        this.logger.warn(`Agent ${session.nodeName} reported ${message.payload.code}: ${message.payload.message}`);
        break;
    }
  }

  async pushDesiredState(session: AgentSession, left = false): Promise<void> {
    // Not before the hello: the state would go out stripped to the legacy protocol (see `AgentSession.negotiated`);
    // the hello pushes it right after the negotiation.
    if (!session.negotiated) return;

    const last = await this.network.getDesiredState(session.nodeName);
    const state = last && left ? leftNodeState(last) : last;

    if (!state || state.revision <= session.sentRevision) return;

    const withSecrets = withPushSecrets(state, process.env);

    // The member's Postgres server certificate from the cluster CA (stored, reused until a third of its lifetime is
    // left), at push time only (3.2, `postgres-tls`).
    if (withSecrets.controlPlane.role === 'member' && session.protocol.features.has('postgres-tls')) {
      const address = withSecrets.controlPlane.members.find((m) => m.name === session.nodeName)?.address;

      if (address)
        withSecrets.controlPlane = {
          ...withSecrets.controlPlane,
          postgresTls: await this.identity.memberPostgresCertificate(session.nodeName, address),
        };
    }

    // Database handover (3.43): an external control plane keeps the members' API replicas stopped until the cluster's
    // database is on the members (stripped for agents without `database-handover`).
    const database = memberDatabaseFlag(databaseTarget.deployment, databaseTarget.target);

    if (withSecrets.controlPlane.role === 'member' && database)
      withSecrets.controlPlane = { ...withSecrets.controlPlane, database };

    // Fencing epoch (3.43 takeover): members with data of an older epoch move it aside and start empty (stripped for
    // agents without `database-fencing`).
    const databaseFence = databaseTarget.databaseFence();

    if (withSecrets.controlPlane.role === 'member' && databaseFence)
      withSecrets.controlPlane = { ...withSecrets.controlPlane, databaseFence };

    // BGP session passwords from secrets, at push time only (3.27).
    if (withSecrets.externalBgp?.peers.length) {
      const peers = bgpResources(
        await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'BgpPeer' } }),
      ).peers;
      const withPasswords = [];

      for (const peer of withSecrets.externalBgp.peers) {
        const ref = peers.get(peer.name)?.password;
        const password = ref
          ? (await this.credentials.read(ref).catch(() => null))?.toString('utf8').trim()
          : undefined;

        if (ref && (!password || !/^[\x21\x23-\x5b\x5d-\x7e]{1,80}$/.test(password)))
          this.logger.warn(`BGP password for ${peer.name} missing or not usable; the session stays without it`);

        withPasswords.push(
          password && /^[\x21\x23-\x5b\x5d-\x7e]{1,80}$/.test(password) ? { ...peer, password } : peer,
        );
      }

      withSecrets.externalBgp = { ...withSecrets.externalBgp, peers: withPasswords };
    }

    // Ingress certificate keys are added here, at push time only (3.6).
    if (withSecrets.ingress && withSecrets.ingress.certificates.length > 0) {
      const keys = await this.certificates.keys(withSecrets.ingress.certificates.map((c) => c.id));

      withSecrets.ingress = {
        ...withSecrets.ingress,
        certificates: withSecrets.ingress.certificates.map((c) =>
          keys.has(c.id) ? { ...c, privateKeyPem: keys.get(c.id) } : c,
        ),
      };
    }

    // DNSSEC private keys and TSIG secrets for hosted bind9, at push time only (3.15).
    if (withSecrets.authoritativeDns) {
      const dns = withSecrets.authoritativeDns;
      const privateKeys = await this.dnssec.privateKeys(
        dns.zones.flatMap((z) => z.dnssec?.keys.map((k) => k.publicKey) ?? []),
      );
      const providers = dnsProviders(
        await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'DnsProvider' } }),
      );
      const tsigKeys = [];

      for (const key of dns.tsigKeys ?? []) {
        const ref = providers.get(key.name)?.credentials;
        const secret = ref ? (await this.credentials.read(ref).catch(() => null))?.toString('utf8').trim() : undefined;
        const usable = !!secret && secret.length <= 128 && /^[A-Za-z0-9+/]+={0,2}$/.test(secret);

        if (!usable) this.logger.warn(`TSIG secret of ${key.name} missing or not base64; its zones stay as they are`);

        tsigKeys.push(usable ? { ...key, secret } : key);
      }

      withSecrets.authoritativeDns = {
        ...dns,
        zones: dns.zones.map((z) =>
          z.dnssec
            ? {
                ...z,
                dnssec: {
                  ...z.dnssec,
                  keys: z.dnssec.keys.map((k) =>
                    privateKeys.has(k.publicKey) ? { ...k, privateKey: privateKeys.get(k.publicKey) } : k,
                  ),
                },
              }
            : z,
        ),
        ...(dns.tsigKeys ? { tsigKeys } : {}),
      };
    }

    // The remote access gateways' shared key, at push time only (3.31).
    if (withSecrets.network.remoteAccess) {
      const privateKey = await this.remoteAccess.gatewayPrivateKey();

      if (privateKey)
        withSecrets.network = {
          ...withSecrets.network,
          remoteAccess: { ...withSecrets.network.remoteAccess, privateKey },
        };
      else this.logger.warn(`No remote access gateway key yet; ${session.nodeName} leaves lw-vpn as it is`);
    }

    // Backup repository servers on members (3.20): object-store key, repository / user passwords, TLS key.
    if (withSecrets.backupServer)
      withSecrets.backupServer = await this.backupRepositories.withServerSecrets(withSecrets.backupServer);

    session.send(controlPlaneMessage('desiredState', withSecrets));
    session.sentRevision = state.revision;
  }

  /**
   * A node that left the cluster but is still connected here (3.43): the leave closes only the session on the replica
   * that handled it, while the agent may stream to another one. It gets its last state without the control-plane role
   * (`leftNodeState`), then the session ends; its certificate no longer authenticates, so it doesn't come back.
   */
  private async farewell(session: AgentSession): Promise<void> {
    await this.pushDesiredState(session, true).catch((error: unknown) =>
      this.logger.warn(
        `Last state to ${session.nodeName} failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    this.logger.log(`Agent ${session.nodeName} left the cluster: role removed, session closed`);
    this.registry.disconnect(session.nodeName, 'node left the cluster');
  }

  private async pushToAll(): Promise<void> {
    const sessions = this.registry.all();
    const left = sessions.length
      ? new Set(
          (
            await this.dataSource
              .getRepository(NodeEntity)
              .find({
                where: { name: In(sessions.map((s) => s.nodeName)), lifecycle: 'left' },
                select: { name: true },
              })
              .catch(() => [])
          ).map((n) => n.name),
        )
      : new Set<string>();

    for (const session of sessions) {
      if (left.has(session.nodeName)) {
        await this.farewell(session);
        continue;
      }

      await this.pushDesiredState(session).catch((error: unknown) =>
        this.logger.warn(
          `Push to ${session.nodeName} failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }

  /**
   * Dedicated connection that LISTENs for new revisions; reconnects on failure with a back-off, logging the loss and the
   * recovery once (3.43 live test: 8 lines while the members' leader was gone).
   */
  private async listenForDesiredState(): Promise<void> {
    while (!this.stopped) {
      let delay: number;

      try {
        const driver = this.dataSource.driver as PostgresDriver;
        const [client, release] = (await driver.obtainMasterConnection()) as [
          {
            query(sql: string): Promise<unknown>;
            on(event: string, cb: (...args: unknown[]) => void): void;
            removeAllListeners(event: string): void;
          },
          (err?: unknown) => void,
        ];
        const closed = new Promise<void>((resolve) => {
          client.on('error', () => resolve());
          client.on('end', () => resolve());
        });

        let released = false;

        this.releaseListener = () => {
          if (released) return;

          released = true;
          client.removeAllListeners('notification');
          release(true);
        };
        client.on('notification', (...args: unknown[]) => {
          const notification = args[0] as { channel?: string; payload?: string };

          if (notification.channel === UNSEAL_CHANNEL && notification.payload)
            void this.masterKey.relay(notification.payload).catch(() => undefined);
          else void this.pushToAll();
        });
        await client.query(`LISTEN ${DESIRED_STATE_CHANNEL}`);
        await client.query(`LISTEN ${UNSEAL_CHANNEL}`);
        this.listenBackoff.succeeded();
        // Revisions compiled while nothing listened (API start, a refused LISTEN during recovery, a dropped connection)
        // sent no notification here: catch up once listening (G5 2026-10-28: a node right after bootstrap got no
        // desired state for 8 min). Pushes only what is newer than each session's last revision.
        void this.pushToAll();
        await closed;
        this.releaseListener();
        this.releaseListener = null;
        delay = this.stopped ? 0 : this.listenBackoff.failed(new Error('connection closed'));
      } catch (error) {
        // Give the dedicated connection back (G5: a refused LISTEN — Postgres in recovery — kept it; every retry took
        // another one until the pool was empty and every query of the API waited forever).
        this.releaseListener?.();
        this.releaseListener = null;
        delay = this.stopped ? 0 : this.listenBackoff.failed(error);
      }

      if (!this.stopped) await new Promise((r) => setTimeout(r, delay));
    }
  }
}
