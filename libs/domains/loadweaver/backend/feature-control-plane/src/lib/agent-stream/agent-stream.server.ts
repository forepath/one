import { randomUUID } from 'node:crypto';

import {
  controlPlaneMessage,
  decodeAgentMessage,
  envelopeForNode,
  LEGACY_PROTOCOL,
  MAX_ENVELOPE_BYTES,
  negotiate,
  NODE_AGENT_SERVICE,
  type DesiredState,
  type Envelope,
  type FieldGates,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { getQueueRole, shouldRunApiHttp } from '@forepath/shared/backend';
import { Server, ServerCredentials, status, type ServerDuplexStream } from '@grpc/grpc-js';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryFailedError } from 'typeorm';
import type { PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver';

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

/** Per-session message budget; agents send a heartbeat every few seconds plus occasional reports. */
const MAX_MESSAGES_PER_WINDOW = 200;
const RATE_WINDOW_MS = 10_000;
const RECONCILE_INTERVAL_MS = 15_000;
const LISTEN_RETRY_MS = 5_000;

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
  const environment = replicatedEnvironment(env);
  const hostnames = environment['LOADWEAVER_GRPC_HOSTNAMES'];

  if (hostnames) {
    const members = new Set(state.controlPlane.members.map((m) => m.address));
    const kept = hostnames.split(',').filter((h) => h && !members.has(h));

    if (kept.length) environment['LOADWEAVER_GRPC_HOSTNAMES'] = kept.join(',');
    else delete environment['LOADWEAVER_GRPC_HOSTNAMES'];
  }

  return environment;
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
 * A node's session on this replica. Every message to the node passes its `send`, which strips the fields the
 * node's negotiated protocol doesn't have (3.26): legacy until the hello, then what the hello advertised.
 * `gates` is for tests.
 */
export function createAgentSession(nodeName: string, stream: AgentSessionStream, gates?: FieldGates): AgentSession {
  const session: AgentSession = {
    nodeName,
    sessionId: randomUUID(),
    connectedAt: new Date(),
    sentRevision: -1,
    protocol: LEGACY_PROTOCOL,
    send: (envelope) => {
      if (stream.writableEnded) return;

      // `null`: a message type the node didn't advertise (e.g. live migration): never sent (3.26).
      const gated = envelopeForNode(envelope, session.protocol, gates);

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
  private stopped = false;

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
    let window = { start: Date.now(), count: 0 };
    let queue: Promise<void> = Promise.resolve();
    const session = createAgentSession(name, call);

    this.registry.register(session);
    // Live sessions for this node are relayed to this replica (3.19).
    void this.live.owned(name).catch(() => undefined);
    this.logger.log(`Agent ${name} connected`);

    call.on('data', (envelope: Envelope) => {
      const now = Date.now();

      if (now - window.start > RATE_WINDOW_MS) window = { start: now, count: 0 };

      if (++window.count > MAX_MESSAGES_PER_WINDOW) {
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

        session.sentRevision = -1;
        await this.pushDesiredState(session);
        break;
      case 'heartbeat':
        await this.agents.handleHeartbeat(session.nodeName, message.payload);
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

  async pushDesiredState(session: AgentSession): Promise<void> {
    const state = await this.network.getDesiredState(session.nodeName);

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

  private async pushToAll(): Promise<void> {
    for (const session of this.registry.all()) {
      await this.pushDesiredState(session).catch((error: unknown) =>
        this.logger.warn(
          `Push to ${session.nodeName} failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }

  /** Dedicated connection that LISTENs for new revisions; reconnects on failure. */
  private async listenForDesiredState(): Promise<void> {
    while (!this.stopped) {
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
        await closed;
        this.releaseListener();
        this.releaseListener = null;
      } catch (error) {
        this.logger.warn(`Desired-state listener failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      if (!this.stopped) await new Promise((r) => setTimeout(r, LISTEN_RETRY_MS));
    }
  }
}
