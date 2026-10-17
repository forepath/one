import { randomUUID } from 'node:crypto';

import {
  controlPlaneMessage,
  decodeAgentMessage,
  MAX_ENVELOPE_BYTES,
  NODE_AGENT_SERVICE,
  type DesiredState,
  type Envelope,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { getQueueRole, shouldRunApiHttp } from '@forepath/shared/backend';
import { Server, ServerCredentials, status, type ServerDuplexStream } from '@grpc/grpc-js';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver';

import { DEFAULT_GRPC_PORT } from '../constants/control-plane.constants';
import { objectStoreSecrets } from '../object-store/object-store.utils';
import { NodeEntity } from '../entities/node.entity';
import { ClusterIdentityService, derToPem } from '../services/cluster-identity.service';
import { DESIRED_STATE_CHANNEL, NetworkStateService, replicatedEnvironment } from '../services/network-state.service';
import { MasterKeyService, UNSEAL_CHANNEL } from '../services/master-key.service';
import { NodeAgentsService } from '../services/node-agents.service';
import { SecretsService } from '../services/secrets.service';
import { NODE_PULL_TOKEN_SECONDS, RegistryTokenService } from '../services/registry-token.service';
import { CertificatesService } from '../acme/certificates.service';
import { bgpResources } from '../bgp/bgp-state.utils';
import { ResourceEntity } from '../entities/resource.entity';
import { PlatformCredentialsService } from '../services/platform-credentials.service';
import { RemoteAccessService } from '../remote-access/remote-access.service';
import { DnsFailoverControllerService } from '../dns/dns-failover-controller.service';
import { dnsProviders } from '../dns/dns.service';
import { DnssecService } from '../dns/dnssec.service';
import { WorkloadIdentityService } from '../mesh/workload-identity.service';
import { ImagePolicyService } from '../images/image-policy.service';
import { AgentSessionRegistry, type AgentSession } from './agent-session.registry';

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
export function withPushSecrets(state: DesiredState, env: NodeJS.ProcessEnv): DesiredState {
  const key = env['ENCRYPTION_KEY'];
  const next: DesiredState =
    state.controlPlane.role === 'member'
      ? { ...state, controlPlane: { ...state.controlPlane, environment: replicatedEnvironment(env) } }
      : { ...state };

  if (!key) return next;

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
    private readonly failover: DnsFailoverControllerService,
    private readonly dnssec: DnssecService,
    private readonly workloadIdentities: WorkloadIdentityService,
    private readonly imagePolicies: ImagePolicyService,
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
    const session: AgentSession = {
      nodeName: name,
      sessionId: randomUUID(),
      connectedAt: new Date(),
      sentRevision: -1,
      send: (envelope) => {
        if (!call.writableEnded) call.write(envelope);
      },
      close: (reason) => {
        if (!call.writableEnded) {
          call.write(controlPlaneMessage('error', { code: 'closed', message: reason }));
          call.end();
        }
      },
    };

    this.registry.register(session);
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

    switch (message.type) {
      case 'hello':
        await this.agents.handleHello(session.nodeName, message.payload);
        session.sentRevision = -1;
        await this.pushDesiredState(session);
        break;
      case 'heartbeat':
        await this.agents.handleHeartbeat(session.nodeName, message.payload);
        break;
      case 'applyReport':
        await this.agents.handleApplyReport(session.nodeName, message.payload);
        break;
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
