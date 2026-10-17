import { z } from 'zod';

import { httpMatchSchema } from '@forepath/loadweaver/shared/util-model';
import { isCidr, isIp, parseCidr } from '@forepath/loadweaver/shared/util-network';
import type { NodeNetworkConfig as CompiledNodeNetworkConfig } from '@forepath/loadweaver/shared/util-policy-compiler';

const name = z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/);
/**
 * Everything below ends up in `wg`, `ip`, nftables and BIRD on the node, so the node validates it again
 * (defense in depth): addresses must be IPs or CIDRs, keys and names have strict formats.
 */
const ipAddress = z
  .string()
  .max(64)
  .refine((v) => isIp(v), 'invalid IP address');
const ipOrCidr = z
  .string()
  .max(64)
  .refine((v) => isIp(v) || isCidr(v), 'invalid address');
const addressList = z.array(ipOrCidr).max(100_000);
const portNumber = z.number().int().min(1).max(65535);
/** `project/deployment/service`: a workload identity (3.7). */
const workloadIdentity = z.string().regex(/^[a-z0-9-]{1,63}\/[a-z0-9-]{1,63}\/[a-z0-9_.-]{1,63}$/);
const meshUpstreamName = z.string().regex(/^[a-z0-9-]{1,63}\/[a-z0-9-]{1,63}\/[a-z0-9_.-]{1,63}:\d{1,5}$/);
/** A hostname rule of egress filtering; written into Envoy matchers, so strictly a hostname pattern. */
const egressHostRule = z
  .object({
    host: z
      .string()
      .max(253)
      .regex(/^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i),
    ports: z.array(z.literal([80, 443])).max(2),
    policy: z.string().max(200),
    monitor: z.boolean(),
  })
  .strict();
const meshSni = z.string().regex(/^\d{1,5}\.[a-z0-9_.-]{1,200}\.mesh\.lw$/);
const wireguardKey = z.string().regex(/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$/, 'invalid WireGuard key');
const dnsName = z
  .string()
  .max(253)
  .regex(/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/, 'invalid DNS name');

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/**
 * Public WireGuard endpoint of a node. It ends up in other nodes' peer configuration, so only plain
 * hostnames and IP literals are accepted (no ports, schemes, whitespace or shell metacharacters).
 */
export const endpointHostSchema = z
  .string()
  .max(253)
  .refine((v) => isIp(v) || HOSTNAME.test(v), 'invalid endpoint host');

/** What a node can do; the scheduler only places `sandboxed` workloads on nodes whose probe passed (3.1). */
export const nodeCapabilitiesSchema = z
  .object({
    runtimes: z.array(z.enum(['runc', 'sandboxed'])),
    sandboxProbe: z.enum(['ready', 'missing', 'failed', 'unknown']),
    wireguard: z.boolean(),
    nftables: z.boolean(),
    bird: z.boolean(),
    drbd: z.boolean(),
    criu: z.boolean(),
    dockerVersion: z.string().max(64).optional(),
  })
  .strict();
export type NodeCapabilities = z.infer<typeof nodeCapabilitiesSchema>;

export const nodeOsSchema = z
  .object({
    id: z.string().max(32),
    versionId: z.string().max(32),
    kernel: z.string().max(128),
    arch: z.enum(['amd64', 'arm64']),
  })
  .strict();
export type NodeOs = z.infer<typeof nodeOsSchema>;

export const resourceAmountsSchema = z
  .object({
    cpuMillis: z.number().int().nonnegative(),
    memoryBytes: z.number().int().nonnegative(),
    diskBytes: z.number().int().nonnegative(),
  })
  .strict();
export type ResourceAmounts = z.infer<typeof resourceAmountsSchema>;

export const agentHelloSchema = z
  .object({
    nodeName: name,
    agentVersion: z.string().max(64),
    os: nodeOsSchema,
    capabilities: nodeCapabilitiesSchema,
    capacity: resourceAmountsSchema,
    wireguardPublicKey: z.string().regex(/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$/, 'invalid WireGuard public key'),
    endpointHost: endpointHostSchema.optional(),
    /** X25519 public key master-key shares are encrypted to (3.22); the private key never leaves the node. */
    sealPublicKey: z
      .string()
      .regex(/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$/, 'invalid seal key')
      .optional(),
    appliedRevision: z.number().int().nonnegative(),
  })
  .strict();
export type AgentHello = z.infer<typeof agentHelloSchema>;

export const heartbeatSchema = z
  .object({
    appliedRevision: z.number().int().nonnegative(),
    usage: resourceAmountsSchema,
    at: z.string().datetime(),
  })
  .strict();
export type Heartbeat = z.infer<typeof heartbeatSchema>;

const firewallRuleSchema = z
  .object({
    id: z.string().max(512),
    policy: z.string().max(256),
    chain: z.enum(['input', 'forward', 'output']),
    srcSet: z.string().regex(/^lw_[0-9a-f]{8}$/),
    dstSet: z.string().regex(/^lw_[0-9a-f]{8}$/),
    protocol: z.enum(['tcp', 'udp', 'icmp', 'any']),
    ports: z.array(z.string().regex(/^\d{1,5}(-\d{1,5})?$/)),
    action: z.enum(['accept', 'observe']),
  })
  .strict();

/** Validates network configuration on the node before anything touches the host (defense against bugs). */
export const nodeNetworkConfigSchema = z
  .object({
    node: name,
    addresses: addressList,
    wireguard: z.array(
      z
        .object({
          interface: z.string().regex(/^lw-[0-9a-f]{8}$/),
          listenPort: z.number().int().min(1024).max(65535),
          peer: name,
          peerPublicKey: wireguardKey,
          peerEndpoint: z
            .string()
            .max(300)
            .regex(/^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+):\d{1,5}$/, 'invalid peer endpoint')
            .optional(),
          allowedIps: addressList,
          persistentKeepalive: z.number().int().min(1).max(3600).optional(),
          addresses: addressList,
          peerAddresses: addressList,
          reasons: z.array(z.string().max(256)),
        })
        .strict(),
    ),
    services: z.array(z.object({ name: dnsName, serviceIp: ipAddress, backends: addressList }).strict()),
    bgp: z
      .object({
        asn: z.number().int().min(1).max(4294967295),
        routerId: z
          .string()
          .regex(/^(\d{1,3}\.){3}\d{1,3}$/)
          .refine((v) => isIp(v), 'invalid router id'),
        routeReflector: z.boolean(),
        originate: addressList,
        sessions: z.array(
          z
            .object({
              peer: name,
              interface: z.string().regex(/^lw-[0-9a-f]{8}$/),
              peerAddress: ipAddress,
              peerAddresses: addressList,
              role: z.enum(['peer', 'route-reflector', 'route-reflector-client']),
              exports: addressList,
              imports: addressList,
            })
            .strict(),
        ),
      })
      .strict(),
    firewall: z
      .object({ sets: z.record(z.string().regex(/^lw_[0-9a-f]{8}$/), addressList), rules: z.array(firewallRuleSchema) })
      .strict(),
    dns: z
      .object({
        domain: z.string().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/),
        records: z.array(z.object({ name: dnsName, addresses: addressList }).strict()),
        visibility: z.record(ipAddress, z.array(dnsName)),
      })
      .strict(),
    mesh: z
      .object({
        identities: z.array(workloadIdentity).max(1024),
        outbound: z
          .array(
            z
              .object({
                source: ipAddress,
                identity: workloadIdentity,
                serviceIp: ipAddress,
                port: portNumber,
                upstream: meshUpstreamName,
              })
              .strict(),
          )
          .max(16384),
        upstreams: z
          .array(
            z
              .object({
                name: meshUpstreamName,
                sni: meshSni,
                identity: workloadIdentity,
                endpoints: z.array(ipAddress).max(1024),
              })
              .strict(),
          )
          .max(4096),
        inbound: z
          .array(
            z
              .object({
                sni: meshSni,
                identity: workloadIdentity,
                port: portNumber,
                backends: z.array(ipAddress).max(1024),
                http: z.boolean(),
                rules: z
                  .array(
                    z
                      .object({
                        identity: workloadIdentity,
                        policy: z.string().max(200),
                        mode: z.enum(['enforce', 'monitor']),
                        action: z.enum(['allow', 'deny']),
                        http: httpMatchSchema.optional(),
                      })
                      .strict(),
                  )
                  .max(1024),
              })
              .strict(),
          )
          .max(4096),
      })
      .strict()
      .optional(),
    egressFilter: z
      .object({
        mode: z.enum(['monitor', 'enforce', 'offline']),
        blockPrivateNetworks: z.boolean(),
        blockIpLiterals: z.boolean(),
        logAllowed: z.boolean(),
        clusterRanges: z.array(ipOrCidr).max(16),
        sources: z
          .array(
            z
              .object({
                /** A workload or client address, or an office network behind a machine client (3.31). */
                address: ipOrCidr,
                ports: z
                  .array(z.object({ port: z.literal([80, 443]), destinations: addressList.max(4096) }).strict())
                  .max(2),
                allow: z.array(egressHostRule).max(5000),
                deny: z.array(egressHostRule).max(5000),
                allowCidrs: addressList.max(4096),
                unrestricted: z.boolean(),
              })
              .strict(),
          )
          .max(4096),
      })
      .strict()
      .optional(),
    remoteAccess: z
      .object({
        active: z.boolean(),
        listenPort: portNumber,
        address: z
          .string()
          .max(64)
          // An address with its network's prefix length (`100.96.0.1/24`), IPv4.
          .refine((v) => parseCidr(v, false)?.family === 4, 'invalid gateway address'),
        peers: z
          .array(
            z
              .object({
                id: z.string().uuid(),
                label: z.string().max(320),
                publicKey: wireguardKey,
                allowedIps: addressList.max(64),
              })
              .strict(),
          )
          .max(20_000),
        prefixes: addressList.max(20_000),
        /** The shared gateway key, added at push time only and never stored with the desired state (3.31). */
        privateKey: wireguardKey.optional(),
      })
      .strict()
      .optional(),
    egress: z
      .object({
        routes: z.array(
          z
            .object({
              interface: z.string().regex(/^lw-[0-9a-f]{8}$/),
              sources: z.array(ipAddress).max(4096),
              destinations: addressList.max(4096),
            })
            .strict(),
        ),
        snat: z.array(z.object({ address: ipAddress, sources: z.array(ipAddress).max(4096) }).strict()),
      })
      .strict()
      .optional(),
  })
  .strict() satisfies z.ZodType<CompiledNodeNetworkConfig>;

/** Control-plane member configuration for etcd + Patroni on this node (3.2). */
export const controlPlaneRoleSchema = z
  .object({
    role: z.enum(['none', 'member', 'witness']),
    members: z.array(z.object({ name, address: z.string().max(64), witness: z.boolean() }).strict()),
    /** Automatic failover needs a quorum; 2 members without witness need a manual confirm (3.2). */
    automaticFailover: z.boolean(),
    /** Patroni / etcd scope (the cluster id). */
    scope: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/),
    /**
     * Configuration shared by all control-plane members (database credentials, encryption key, auth settings).
     * Only sent to members, over the authenticated stream; written 0600 on the node, never logged.
     */
    environment: z.record(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), z.string().max(8192)).optional(),
  })
  .strict();
export type ControlPlaneRole = z.infer<typeof controlPlaneRoleSchema>;

const portSchema = z.number().int().min(1).max(65535);
const absolutePath = z
  .string()
  .regex(/^\/[^\0]*$/)
  .max(4096);

/** One replica the node runs (3.11): translated from compose by the control plane, executed via the Docker API. */
export const workloadSpecSchema = z
  .object({
    /** `project/deployment/service/<index>`; cron runs use their run sequence as index. */
    id: z.string().regex(/^[a-z0-9-]+\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/\d{1,9}$/),
    project: name,
    deployment: z.string().max(63),
    service: z.string().max(63),
    kind: z.enum(['service', 'job', 'cron']),
    /** Image pinned to a digest at plan time (3.22). */
    image: z.string().max(512),
    /** Vulnerability limits of the image policies covering this service (3.22), checked after the pull. */
    /** Vulnerability limits, one rule per image policy covering the service (3.22): each is judged on its own. */
    imagePolicy: z
      .array(
        z
          .object({
            mode: z.enum(['enforce', 'monitor']),
            block: z
              .array(z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']))
              .min(1)
              .max(4),
            ignoreUnfixed: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(64)
      .optional(),
    command: z.array(z.string().max(8192)).max(256).optional(),
    entrypoint: z.array(z.string().max(8192)).max(256).optional(),
    environment: z.record(z.string().max(256), z.string().max(32768)),
    labels: z.record(z.string().max(253), z.string().max(4096)),
    user: z.string().max(64).optional(),
    workingDir: absolutePath.optional(),
    hostname: z.string().max(63).optional(),
    addresses: z
      .array(
        z
          .string()
          .max(64)
          .refine((v) => isIp(v), 'invalid address'),
      )
      .min(1)
      .max(2),
    dnsSearch: z.array(z.string().max(253)).max(6),
    runtime: z.enum(['runc', 'sandboxed']),
    resources: z
      .object({
        cpuMillis: z.number().int().nonnegative(),
        memoryBytes: z.number().int().nonnegative(),
        cpuLimitMillis: z.number().int().positive().optional(),
        memoryLimitBytes: z.number().int().positive().optional(),
      })
      .strict(),
    healthcheck: z
      .object({
        test: z.array(z.string().max(8192)).nullable(),
        intervalMs: z.number().int().nonnegative(),
        timeoutMs: z.number().int().nonnegative(),
        retries: z.number().int().nonnegative(),
        startPeriodMs: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    restart: z.enum(['no', 'always', 'on-failure', 'unless-stopped']),
    stopGracePeriodMs: z.number().int().nonnegative(),
    stopSignal: z
      .string()
      .regex(/^[A-Z0-9]{2,16}$/)
      .optional(),
    init: z.boolean(),
    readOnly: z.boolean(),
    privileged: z.boolean(),
    capAdd: z.array(z.string().regex(/^[A-Z_]{2,32}$/)),
    capDrop: z.array(z.string().regex(/^[A-Z_]{2,32}$/)),
    ulimits: z.record(z.string().max(32), z.object({ soft: z.number().int(), hard: z.number().int() }).strict()),
    extraHosts: z.array(z.string().max(300)),
    volumes: z.array(
      z.union([
        z
          .object({
            type: z.literal('volume'),
            volume: z.string().max(200),
            target: absolutePath,
            readOnly: z.boolean(),
          })
          .strict(),
        z
          .object({ type: z.literal('bind'), source: absolutePath, target: absolutePath, readOnly: z.boolean() })
          .strict(),
        z
          .object({ type: z.literal('tmpfs'), target: absolutePath, sizeBytes: z.number().int().positive().optional() })
          .strict(),
      ]),
    ),
    /** Secret references; values are fetched over the stream and written to tmpfs, never to disk (3.22). */
    secrets: z.array(
      z
        .object({
          ref: z.string().regex(/^secret:\/\/[a-z0-9-]+\/[a-z0-9][a-z0-9._-]*(@\d+)?$/),
          target: absolutePath,
          mode: z.number().int().min(0).max(0o777).optional(),
        })
        .strict(),
    ),
    /** Hash of everything above; a change re-creates the container. */
    specHash: z.string().regex(/^[0-9a-f]{16,64}$/),
  })
  .strict();
export type WorkloadSpec = z.infer<typeof workloadSpecSchema>;

/** Docker volume name of a replicated volume (`project/deployment/volume` → `lw-vol-project.deployment.volume`). */
export function volumeDockerName(volumeId: string): string {
  return `lw-vol-${volumeId.replace(/\//g, '.')}`;
}

/** Secret holding a volume's LUKS key; `lw-` names are reserved for the platform (3.22). */
export function volumeKeyRef(volumeId: string): string {
  const [project, deployment, volume] = volumeId.split('/');

  return `secret://${project}/lw-volume-${deployment}.${volume}`;
}

/** A replicated volume this node holds a copy of (3.5): LVM thin LV → LUKS → DRBD 9. */
export const volumeAssignmentSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/),
    /** Docker volume name the workloads mount. */
    dockerName: z
      .string()
      .regex(/^lw-vol-[a-z0-9_.-]+$/)
      .max(200),
    minor: z.number().int().min(0).max(1_048_575),
    port: z.number().int().min(1024).max(65535),
    sizeBytes: z.number().int().positive(),
    /** Nodes holding a copy, with DRBD node ids and overlay addresses. */
    replicas: z
      .array(z.object({ node: name, nodeId: z.number().int().min(0).max(31), address: ipAddress }).strict())
      .min(1)
      .max(8),
    /** Replication per node pair: C (synchronous, same site) or A (asynchronous, across sites). */
    connections: z.array(z.object({ a: name, b: name, protocol: z.enum(['A', 'C']) }).strict()),
    /** Where the volume's workload runs; only that node promotes it. */
    primary: name,
    /** Secret reference of the LUKS key (3.22: all volumes are encrypted at rest). */
    keyRef: z.string().regex(/^secret:\/\/[a-z0-9-]+\/[a-z0-9][a-z0-9._-]*(@\d+)?$/),
  })
  .strict();
export type VolumeAssignment = z.infer<typeof volumeAssignmentSchema>;

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const registryHost = z
  .string()
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/, 'invalid registry host');

/**
 * One Garage cluster ("generation") the node is part of (3.20). A change of the replication factor needs a new
 * generation; during the copy two run side by side on different ports. Secrets are injected at push time only.
 */
export const objectStoreGenerationSchema = z
  .object({
    generation: z.number().int().min(1),
    replicationFactor: z.number().int().min(1).max(3),
    ports: z.object({ s3: portSchema, rpc: portSchema, admin: portSchema }).strict(),
    /** Garage zone = the node's site. */
    zone: name,
    rpcSecret: hex64.optional(),
    adminToken: hex64.optional(),
  })
  .strict();
export type ObjectStoreGeneration = z.infer<typeof objectStoreGenerationSchema>;

export const objectStoreRoleSchema = z.object({ generations: z.array(objectStoreGenerationSchema).max(2) }).strict();
export type ObjectStoreRole = z.infer<typeof objectStoreRoleSchema>;

/** Registry instances a control-plane member runs (3.22), stored in the active object-store generation. */
export const registryRoleSchema = z
  .object({
    generation: z.number().int().min(1),
    /** Garage S3 endpoint of the generation: the member itself if it holds data, another holder otherwise. */
    s3: z.object({ address: ipAddress, port: portSchema }).strict(),
    bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
    privatePort: portSchema,
    mirrors: z
      .array(
        z
          .object({
            host: registryHost,
            remoteUrl: z
              .string()
              .max(512)
              .regex(/^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/),
            port: portSchema,
          })
          .strict(),
      )
      .max(16),
    /** Set while the object store migrates to a new generation (writes would be lost). */
    readOnly: z.boolean(),
    /** Token authentication of the private instance: JWTs signed by the control plane, chained to the cluster CA. */
    token: z
      .object({
        issuer: z.string().max(253),
        service: z.string().max(253),
        realm: z.string().max(512),
        rootCertificatePem: z.string().max(16_384),
      })
      .strict(),
    accessKeyId: z
      .string()
      .regex(/^GK[0-9a-f]{24}$/)
      .optional(),
    secretAccessKey: hex64.optional(),
    httpSecret: hex64.optional(),
  })
  .strict();
export type RegistryRole = z.infer<typeof registryRoleSchema>;

/** How the node pulls through the built-in registry: a router on loopback forwards to the members (3.22). */
export const registryClientSchema = z
  .object({
    routerPort: portSchema,
    endpoints: z.array(ipAddress).min(1).max(7),
    privateHost: registryHost,
    privatePort: portSchema,
    mirrors: z.array(z.object({ host: registryHost, port: portSchema }).strict()).max(16),
  })
  .strict();
export type RegistryClient = z.infer<typeof registryClientSchema>;

/**
 * A public address the node may hold (3.6, 3.27). `vrrp`: keepalived elects the holder among the candidates;
 * `bgp`: bound locally and announced while healthy; `provider` / `none`: only the active holder binds it.
 */
export const publicAddressSchema = z
  .object({
    address: ipAddress,
    mode: z.enum(['vrrp', 'bgp', 'provider', 'none']),
    active: z.boolean(),
    /** Uplink override from the node label `loadweaver.com/uplink`; default: the interface of the default route. */
    interface: z
      .string()
      .regex(/^[a-zA-Z0-9_.-]{1,15}$/)
      .optional(),
    vrrp: z
      .object({ vrid: z.number().int().min(1).max(255), priority: z.number().int().min(1).max(254) })
      .strict()
      .optional(),
  })
  .strict()
  .refine((a) => (a.mode === 'vrrp') === !!a.vrrp, 'vrrp settings belong to vrrp addresses');
export type PublicAddress = z.infer<typeof publicAddressSchema>;

const hostPattern = z
  .string()
  .max(253)
  .regex(/^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/, 'invalid host');
/** Upstream cluster of the ingress: `project/deployment/service:port` (or `.../udp:port`). */
const upstreamName = z
  .string()
  .regex(/^[a-z0-9-]+\/[a-z0-9_.-]+\/[a-z0-9_.-]+(\/udp)?:\d{1,5}$/, 'invalid upstream name');

/**
 * The ingress of a node (3.6): hostnames routed to services over the overlay, L4 forwards, certificates and
 * pending ACME HTTP-01 challenges. Rendered into Envoy listeners / clusters by the agent. Private keys are
 * injected at push time only.
 */
export const ingressSchema = z
  .object({
    addresses: z.array(ipAddress).min(1).max(16),
    sites: z
      .array(
        z
          .object({
            host: hostPattern,
            routes: z
              .array(
                z
                  .object({
                    prefix: z
                      .string()
                      .regex(/^\/[^\s"\\]*$/)
                      .max(2048),
                    upstream: upstreamName,
                    /** Cluster-wide limits through the rate-limit service (3.6). */
                    rateLimit: z
                      .object({
                        id: z.string().regex(/^[a-f0-9]{16}$/),
                        perIp: z.boolean(),
                        perKeyHeader: z
                          .string()
                          .regex(/^[a-z0-9-]{1,64}$/)
                          .optional(),
                        total: z.boolean(),
                      })
                      .strict()
                      .optional(),
                  })
                  .strict(),
              )
              .min(1)
              .max(64),
            /** Coraza / OWASP CRS for this host (3.6). */
            waf: z.enum(['off', 'monitor', 'enforce']).optional(),
            certificate: z
              .string()
              .regex(/^[a-z0-9-]{1,64}$/)
              .optional(),
          })
          .strict(),
      )
      .max(4096),
    certificates: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9-]{1,64}$/),
            certificatePem: z.string().max(65_536),
            privateKeyPem: z.string().max(16_384).optional(),
          })
          .strict(),
      )
      .max(4096),
    acmeChallenges: z
      .array(
        z
          .object({
            token: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
            keyAuthorization: z.string().regex(/^[A-Za-z0-9_.-]{16,256}$/),
          })
          .strict(),
      )
      .max(256),
    forwards: z
      .array(
        z
          .object({
            protocol: z.enum(['tcp', 'udp']),
            port: portSchema,
            upstream: upstreamName,
            maxConnections: z.number().int().positive().max(1_000_000).optional(),
          })
          .strict(),
      )
      .max(1024),
    upstreams: z
      .array(
        z
          .object({
            name: upstreamName,
            endpoints: z.array(z.object({ address: ipAddress, port: portSchema }).strict()).max(1024),
          })
          .strict(),
      )
      .max(4096),
    /** Rate-limit service on the members, in priority order: every ingress uses the same healthy one. */
    rateLimitService: z
      .object({ endpoints: z.array(ipAddress).min(1).max(7), port: portSchema })
      .strict()
      .optional(),
    /** WAF module (proxy-wasm) the agent fetches from the control plane, verified by SHA-256. */
    wafModule: z
      .object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .optional(),
  })
  .strict();
export type Ingress = z.infer<typeof ingressSchema>;

/** The cluster-wide rate-limit service a control-plane member runs (3.6): configuration rendered centrally. */
export const rateLimiterSchema = z.object({ config: z.string().max(4 * 1024 * 1024), port: portSchema }).strict();
export type RateLimiter = z.infer<typeof rateLimiterSchema>;

/** Base64 without anything that could leave a quoted bind / key-file value. */
const base64Value = (maxLength: number) =>
  z
    .string()
    .max(maxLength)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/);
/** TSIG key names end up quoted in named.conf. */
const tsigKeyName = z.string().regex(/^[a-z0-9][a-z0-9.-]{0,62}$/);

/**
 * Zones this node serves as a hosted bind9 name server (3.15); rendered by the control plane. A zone is either
 * primary here (`file`) or a secondary of external primaries (`primaries`); external secondaries get transfers and
 * NOTIFY (`transfers`). DNSSEC keys are the control plane's, identical on every instance; private keys and TSIG
 * secrets are added at push time only.
 */
export const authoritativeDnsSchema = z
  .object({
    listen: z.array(ipAddress).min(1).max(16),
    zones: z
      .array(
        z
          .object({
            name: dnsName,
            file: z
              .string()
              .max(4 * 1024 * 1024)
              .optional(),
            primaries: z.array(ipAddress).min(1).max(16).optional(),
            /** External secondaries: transfers and NOTIFY, each with its provider's TSIG key. */
            transfers: z
              .array(z.object({ address: ipAddress, key: tsigKeyName }).strict())
              .min(1)
              .max(16)
              .optional(),
            /** TSIG key for `primaries`. */
            transferKey: tsigKeyName.optional(),
            dnssec: z
              .object({
                /** `insecure`: signed until the DS is gone at the parent, then unsigned (bind's safe way out). */
                mode: z.enum(['signed', 'insecure']),
                keys: z
                  .array(
                    z
                      .object({
                        publicKey: base64Value(128),
                        privateKey: base64Value(64).optional(),
                        created: z.iso.datetime(),
                        retired: z.iso.datetime().optional(),
                      })
                      .strict(),
                  )
                  .min(1)
                  .max(4),
              })
              .strict()
              .optional(),
          })
          .strict()
          .refine((z) => !!z.file !== !!z.primaries, 'a zone is either primary (file) or secondary (primaries)')
          .refine((z) => !z.dnssec || !!z.file, 'only primary zones are signed here')
          .refine((z) => !z.primaries || !!z.transferKey, 'transfers from primaries need a TSIG key'),
      )
      .max(1024),
    /**
     * DNS steering (3.28): views in match order, each matching a country / continent (GeoIP) and / or networks, all
     * conditions together; zones listed in a view are served with that view's file there, every other zone is
     * shared. Clients no view matches get the plain zones.
     */
    views: z
      .array(
        z
          .object({
            name: z.string().regex(/^lw-[0-9]{1,3}$/),
            country: z
              .string()
              .regex(/^[A-Z]{2}$/)
              .optional(),
            continent: z.enum(['AF', 'AN', 'AS', 'EU', 'NA', 'OC', 'SA']).optional(),
            networks: z
              .array(z.string().refine((v) => isCidr(v), 'invalid prefix'))
              .max(2048)
              .optional(),
            zones: z.array(z.object({ name: dnsName, file: z.string().max(4 * 1024 * 1024) }).strict()).max(64),
          })
          .strict()
          .refine((v) => !!(v.country || v.continent || v.networks), 'a view needs something to match'),
      )
      .max(64)
      .optional(),
    /** GeoIP country database the agent fetches from the control plane, verified by SHA-256. */
    geoip: z
      .object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .optional(),
    tsigKeys: z
      .array(
        z
          .object({
            name: tsigKeyName,
            algorithm: z.enum(['hmac-sha256', 'hmac-sha512']),
            secret: base64Value(128).optional(),
          })
          .strict(),
      )
      .max(16)
      .optional(),
  })
  .strict();
export type AuthoritativeDns = z.infer<typeof authoritativeDnsSchema>;

const asn = z.number().int().min(1).max(4_294_967_295);
const cidr = z
  .string()
  .max(64)
  .refine((v) => isCidr(v), 'invalid prefix');

/**
 * eBGP with the outside world on edge nodes (3.27): own ASN, peers with import policy and limits, the prefixes to
 * announce with communities / prepends / MED, RPKI validators. Peer passwords are injected at push time only.
 */
export const externalBgpSchema = z
  .object({
    asn,
    peers: z
      .array(
        z
          .object({
            name,
            address: ipAddress,
            asn,
            multihop: z.number().int().min(1).max(255).optional(),
            // Printable ASCII without quotes and backslashes: it is written into a quoted BIRD string.
            password: z
              .string()
              .max(80)
              .regex(/^[\x21\x23-\x5b\x5d-\x7e]+$/)
              .optional(),
            bfd: z.boolean(),
            import: z.enum(['none', 'default', 'partial', 'full']),
            maxPrefixes: z.number().int().min(1).max(5_000_000),
            localPref: z.number().int().min(0).max(4_294_967_295).optional(),
          })
          .strict(),
      )
      .max(64),
    announcements: z
      .array(
        z
          .object({
            prefix: cidr,
            peers: z.array(name).max(64),
            communities: z.array(z.string().regex(/^\d{1,5}:\d{1,5}$/)).max(32),
            prepend: z.number().int().min(0).max(10),
            med: z.number().int().min(0).max(4_294_967_295).optional(),
          })
          .strict(),
      )
      .max(4096),
    rtrServers: z.array(z.object({ address: ipAddress, port: portSchema }).strict()).max(4),
    /** RFC 8326: announce with GRACEFUL_SHUTDOWN while the node drains, so traffic moves before sessions drop. */
    gracefulShutdown: z.boolean(),
  })
  .strict();
export type ExternalBgp = z.infer<typeof externalBgpSchema>;

/** Health probe the node runs for the control plane (3.28); results come back as `probeResults`. */
export const probeSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9:._/-]{0,190}$/),
    address: ipAddress,
    port: portSchema,
    protocol: z.enum(['http', 'https', 'tcp']),
    /** HTTP(S): Host header / SNI and path. */
    host: dnsName.optional(),
    path: z
      .string()
      .regex(/^\/[^\s"\\]*$/)
      .max(1024)
      .optional(),
    expectStatus: z.tuple([z.number().int(), z.number().int()]).optional(),
    intervalSeconds: z.number().int().min(5).max(300),
  })
  .strict();
export type Probe = z.infer<typeof probeSchema>;

export const desiredStateSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    network: nodeNetworkConfigSchema,
    controlPlane: controlPlaneRoleSchema,
    /** Replicas this node runs (3.11). */
    workloads: z.array(workloadSpecSchema).default([]),
    /** Volumes this node holds a replica of (3.5). */
    volumes: z.array(volumeAssignmentSchema).default([]),
    /** Garage generations this node holds data of (3.20). */
    objectStore: objectStoreRoleSchema.optional(),
    /** Registry instances on control-plane members (3.22). */
    registry: registryRoleSchema.optional(),
    /** Pulls through the built-in registry. */
    registryClient: registryClientSchema.optional(),
    /** Public addresses this node may hold (ingress, port forwards, egress, DNS). */
    publicAddresses: z.array(publicAddressSchema).max(256).optional(),
    /** Ingress on nodes that may hold ingress addresses. */
    ingress: ingressSchema.optional(),
    /** Hosted bind9 on name-server nodes. */
    authoritativeDns: authoritativeDnsSchema.optional(),
    /** External BGP on edge nodes. */
    externalBgp: externalBgpSchema.optional(),
    /** Endpoint probes this node runs (DNS failover). */
    probes: z.array(probeSchema).max(1024).optional(),
    /** Rate-limit service on control-plane members. */
    rateLimiter: rateLimiterSchema.optional(),
    /** Draining nodes stop accepting work; agents keep running until left (3.12). */
    lifecycle: z.enum(['active', 'cordoned', 'draining', 'leaving']),
  })
  .strict();
export type DesiredState = z.infer<typeof desiredStateSchema>;

export const applyStepSchema = z
  .object({
    layer: z.enum([
      'tunnels',
      'routing',
      'filtering',
      'dns',
      'services',
      'mesh',
      'remote-access',
      'public-addresses',
      'ingress',
      'authoritative-dns',
      'rate-limiter',
      'control-plane',
      'object-store',
      'registry',
      'volumes',
      'workloads',
    ]),
    status: z.enum(['applied', 'unchanged', 'failed', 'skipped']),
    message: z.string().max(2048).optional(),
  })
  .strict();
export type ApplyStep = z.infer<typeof applyStepSchema>;

export const applyReportSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    status: z.enum(['applied', 'failed', 'rolled-back']),
    steps: z.array(applyStepSchema),
    error: z.string().max(4096).optional(),
  })
  .strict();
export type ApplyReport = z.infer<typeof applyReportSchema>;

export const certificateRenewalSchema = z.object({ csrPem: z.string().max(8192) }).strict();
export type CertificateRenewal = z.infer<typeof certificateRenewalSchema>;

/** A vulnerability scan of a pulled image (3.22): counts per severity and the most severe findings. */
export const imageScanSchema = z
  .object({
    image: z.string().max(512),
    digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    scanner: z.string().max(64),
    counts: z.record(
      z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']),
      z.object({ total: z.number().int().min(0), fixable: z.number().int().min(0) }).strict(),
    ),
    findings: z
      .array(
        z
          .object({
            id: z.string().max(128),
            severity: z.string().max(16),
            package: z.string().max(256),
            installed: z.string().max(128),
            fixed: z.string().max(256).nullable(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type ImageScan = z.infer<typeof imageScanSchema>;

/** Remote clients with a recent handshake on the active gateway (3.31), reported periodically. */
export const vpnSessionsSchema = z
  .object({
    sessions: z
      .array(
        z
          .object({
            publicKey: wireguardKey,
            endpoint: z.string().max(64).nullable(),
            latestHandshake: z.number().int().nonnegative(),
            rxBytes: z.number().int().nonnegative(),
            txBytes: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(20_000),
  })
  .strict();
export type VpnSessions = z.infer<typeof vpnSessionsSchema>;

/** CSRs for the workload identities of the node's replicas (3.7); keys never leave the node. */
export const workloadIdentityRequestSchema = z
  .object({
    requests: z.array(z.object({ identity: workloadIdentity, csrPem: z.string().max(8192) }).strict()).max(256),
  })
  .strict();
export type WorkloadIdentityRequest = z.infer<typeof workloadIdentityRequestSchema>;

/** Signed identities (only for services the node runs), with the CA to verify peers against. */
export const workloadIdentitiesSchema = z
  .object({
    certificates: z
      .array(z.object({ identity: workloadIdentity, certificatePem: z.string().max(16384) }).strict())
      .max(256),
    refused: z.array(workloadIdentity).max(256),
    caCertificatePem: z.string().max(16384),
  })
  .strict();
export type WorkloadIdentities = z.infer<typeof workloadIdentitiesSchema>;

export const certificateIssuedSchema = z
  .object({ certificatePem: z.string().max(16384), caCertificatePem: z.string().max(16384) })
  .strict();
export type CertificateIssued = z.infer<typeof certificateIssuedSchema>;

/** Platform events the agent ships off the node immediately (3.14), labelled for correlation. */
const base64 = z
  .string()
  .regex(/^[A-Za-z0-9+/]*={0,2}$/)
  .max(4096);

/** The control plane asks a share holder to re-encrypt its master-key share for a requesting replica (3.22). */
export const unsealShareRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    keyId: z.string().regex(/^[0-9a-f]{16}$/),
    encryptedShare: base64,
    requesterPublicKey: base64,
  })
  .strict();
export type UnsealShareRequest = z.infer<typeof unsealShareRequestSchema>;

export const unsealShareSchema = z
  .object({ requestId: z.string().uuid(), keyId: z.string().regex(/^[0-9a-f]{16}$/), sealedShare: base64 })
  .strict();
export type UnsealShare = z.infer<typeof unsealShareSchema>;

/** Secret values are requested per workload and only for workloads assigned to the node (3.22). */
export const secretRequestSchema = z.object({ workload: z.string().max(256), ref: z.string().max(256) }).strict();
export type SecretRequest = z.infer<typeof secretRequestSchema>;

export const secretValueSchema = z
  .object({
    workload: z.string().max(256),
    ref: z.string().max(256),
    version: z.number().int().positive(),
    valueBase64: z.string().max(2_000_000),
  })
  .strict();
export type SecretValue = z.infer<typeof secretValueSchema>;

/**
 * Pull token for private repositories (3.22). The control plane only grants repositories of images the node's own
 * workloads use, read-only, for a few minutes.
 */
export const registryTokenRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    repositories: z
      .array(
        z
          .string()
          .max(255)
          .regex(/^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/),
      )
      .min(1)
      .max(16),
  })
  .strict();
export type RegistryTokenRequest = z.infer<typeof registryTokenRequestSchema>;

export const registryTokenSchema = z
  .object({
    requestId: z.string().uuid(),
    token: z.string().max(16_384).optional(),
    expiresInSeconds: z.number().int().positive().optional(),
    error: z.string().max(512).optional(),
  })
  .strict();
export type RegistryToken = z.infer<typeof registryTokenSchema>;

export const probeResultsSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            id: z.string().max(192),
            ok: z.boolean(),
            latencyMs: z.number().int().nonnegative().max(600_000).optional(),
            error: z.string().max(256).optional(),
          })
          .strict(),
      )
      .max(1024),
  })
  .strict();
export type ProbeResults = z.infer<typeof probeResultsSchema>;

/** Runtime state of the node's workloads, reported after every reconcile and on changes. */
export const workloadStatusSchema = z
  .object({
    workloads: z.array(
      z
        .object({
          id: z.string().max(256),
          state: z.enum(['pending', 'pulling', 'starting', 'running', 'healthy', 'unhealthy', 'exited', 'failed']),
          exitCode: z.number().int().optional(),
          message: z.string().max(2048).optional(),
          specHash: z.string().max(64),
        })
        .strict(),
    ),
  })
  .strict();
export type WorkloadStatus = z.infer<typeof workloadStatusSchema>;

export const agentEventSchema = z
  .object({
    source: z.enum(['runtime', 'tunnels', 'routing', 'firewall', 'dns', 'storage', 'agent']),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string().max(8192),
    at: z.string().datetime(),
    labels: z.record(z.string().max(128), z.string().max(256)).optional(),
  })
  .strict();
export type AgentEvent = z.infer<typeof agentEventSchema>;

export const errorMessageSchema = z.object({ code: z.string().max(64), message: z.string().max(2048) }).strict();

/** All message types and their payload schemas, per direction. */
export const AGENT_TO_CONTROL_PLANE = {
  hello: agentHelloSchema,
  heartbeat: heartbeatSchema,
  applyReport: applyReportSchema,
  renewCertificate: certificateRenewalSchema,
  event: agentEventSchema,
  secretRequest: secretRequestSchema,
  workloadStatus: workloadStatusSchema,
  unsealShare: unsealShareSchema,
  registryTokenRequest: registryTokenRequestSchema,
  probeResults: probeResultsSchema,
  workloadIdentityRequest: workloadIdentityRequestSchema,
  imageScan: imageScanSchema,
  vpnSessions: vpnSessionsSchema,
  error: errorMessageSchema,
} as const;

export const CONTROL_PLANE_TO_AGENT = {
  desiredState: desiredStateSchema,
  certificateIssued: certificateIssuedSchema,
  secretValue: secretValueSchema,
  unsealShareRequest: unsealShareRequestSchema,
  registryToken: registryTokenSchema,
  workloadIdentities: workloadIdentitiesSchema,
  error: errorMessageSchema,
} as const;

export type AgentMessageType = keyof typeof AGENT_TO_CONTROL_PLANE;
export type ControlPlaneMessageType = keyof typeof CONTROL_PLANE_TO_AGENT;
export type AgentPayload<T extends AgentMessageType> = z.infer<(typeof AGENT_TO_CONTROL_PLANE)[T]>;
export type ControlPlanePayload<T extends ControlPlaneMessageType> = z.infer<(typeof CONTROL_PLANE_TO_AGENT)[T]>;

/** REST join contract (3.21): the node has no certificate yet, so joining uses a short-lived token over HTTPS. */
export const joinRequestSchema = z
  .object({
    token: z.string().min(20).max(256),
    nodeName: name,
    csrPem: z.string().max(8192),
    hello: agentHelloSchema,
    site: name.optional(),
    labels: z.record(z.string().max(253), z.string().max(63)).optional(),
  })
  .strict();
export type JoinRequest = z.infer<typeof joinRequestSchema>;

export const joinResponseSchema = z
  .object({
    clusterId: z.string(),
    nodeName: name,
    certificatePem: z.string(),
    caCertificatePem: z.string(),
    /** gRPC endpoints of the control plane (`host:port`), tried in order. */
    controlPlaneEndpoints: z.array(z.string()),
  })
  .strict();
export type JoinResponse = z.infer<typeof joinResponseSchema>;

export type NodeNetworkConfig = z.infer<typeof nodeNetworkConfigSchema>;
