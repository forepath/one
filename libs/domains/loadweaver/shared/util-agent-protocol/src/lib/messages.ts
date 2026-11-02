import { z } from 'zod';

import {
  execCloseSchema,
  execExitSchema,
  execInputSchema,
  execOpenSchema,
  execOutputSchema,
  execResizeSchema,
  fileRequestSchema,
  consoleOpenSchema,
  fileResponseSchema,
  tunnelCloseSchema,
  tunnelDataSchema,
  tunnelOpenSchema,
  volumeIdSchema,
} from './live';
import { componentVersionsSchema, nodeComponentsSchema } from './components';
import {
  migrationAbortSchema,
  migrationCommitSchema,
  migrationFreezeSchema,
  migrationPrecopySchema,
  migrationPrepareBaseSchema,
  migrationProgressSchema,
  migrationRestoreSchema,
  vmMigrationPrepareBaseSchema,
  vmMigrationStartSchema,
  vmMigrationSwitchoverSchema,
} from './migration';
import { sha256RefSchema, vmImageImportSchema, vmImageRefSchema, vmPowerSchema } from './vm';
import { backupProgressSchema, backupRunSchema, backupServerRoleSchema, restoreRunSchema } from './backups';
import {
  discoveryReportSchema,
  discoveryRequestSchema,
  discoveryResultSchema,
  importProgressSchema,
  importStepCommandSchema,
} from './discovery';

import { httpMatchSchema, LOG_SOURCES } from '@forepath/loadweaver/shared/util-model';
import { isCidr, isIp, parseCidr } from '@forepath/loadweaver/shared/util-network';
import type { NodeNetworkConfig as CompiledNodeNetworkConfig } from '@forepath/loadweaver/shared/util-policy-compiler';

const name = z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/);
/**
 * Everything below ends up in `wg`, `ip`, nftables and BIRD on the node, so the node validates it again
 * (defense in depth): addresses must be IPs or CIDRs, keys and names have strict formats.
 */
/**
 * A host's kernel node name (`uname -n`, at most 64 characters on Linux): DRBD matches its `on <host>` sections
 * against it (3.5). Strict, because it ends up quoted in DRBD configuration files.
 */
export const kernelHostnameSchema = z
  .string()
  .max(64)
  .regex(/^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/);
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
/** A web deny by destination address (3.7). */
const egressCidrRule = z
  .object({
    cidr: ipOrCidr,
    ports: z.array(z.literal([80, 443])).max(2),
    policy: z.string().max(200),
    monitor: z.boolean(),
  })
  .strict();
/** An RE2 regex for the proxy's RBAC (translated and checked by the control plane); never contains control chars. */
const egressUrlRegex = z
  .string()
  .min(1)
  .max(4096)
  // eslint-disable-next-line no-control-regex
  .regex(/^[^\u0000-\u001f\u007f]+$/);
const meshSni = z.string().regex(/^\d{1,5}\.[a-z0-9_.-]{1,200}\.mesh\.lw$/);
const wireguardKey = z.string().regex(/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$/, 'invalid WireGuard key');
const dnsName = z
  .string()
  .max(253)
  .regex(/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/, 'invalid DNS name');

/** Id of an optional agent-protocol feature (see `PROTOCOL_FEATURES`). */
const protocolFeatureId = z.string().regex(/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/);

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/**
 * Public WireGuard endpoint of a node. It ends up in other nodes' peer configuration, so only plain
 * hostnames and IP literals are accepted (no ports, schemes, whitespace or shell metacharacters).
 */
export const endpointHostSchema = z
  .string()
  .max(253)
  .refine((v) => isIp(v) || HOSTNAME.test(v), 'invalid endpoint host');

/**
 * Isolation levels on the wire (3.1), in ladder order: the values of util-model's `RUNTIMES`, re-declared so the
 * wire format doesn't change with the model by accident. Agent → control plane only (capabilities); control plane →
 * agent keeps `workloads[].runtime` at `runc | sandboxed` (the Docker family) and sends the stronger levels in the
 * gated `workloads[].isolation` (no CP → agent enum is widened, see `versioning.ts`).
 */
export const RUNTIMES_WIRE = ['runc', 'sandboxed', 'sandboxed-kvm', 'microvm'] as const;
export type RuntimeWire = (typeof RUNTIMES_WIRE)[number];

/** Probe state of an isolation level on a node (Agenstra's names). */
export const ISOLATION_STATES_WIRE = [
  'ready',
  'unsupported',
  'installation-failed',
  'probe-failed',
  'disabled-by-admin',
] as const;
export type IsolationStateWire = (typeof ISOLATION_STATES_WIRE)[number];

/** Probe result of one isolation level (3.1). */
export const isolationProbeSchema = z
  .object({
    state: z.enum(ISOLATION_STATES_WIRE),
    /** Agenstra's `IsolationReasonCode` strings (`E_KVM_UNAVAILABLE`, …). */
    reasonCode: z.string().max(64).optional(),
    reason: z.string().max(512).optional(),
    checkedAt: z.string().datetime(),
  })
  .strict();
export type IsolationProbe = z.infer<typeof isolationProbeSchema>;

/** KVM facts of the host (`gvisor-host.sh check --json`, util-container-runtime's `GvisorHostKvmFacts`) and the verdict. */
export const kvmFactsSchema = z
  .object({
    cpu: z.enum(['yes', 'no', 'unknown']),
    device: z.enum(['present', 'absent']),
    module: z.enum(['loaded', 'absent']),
    nested: z.enum(['yes', 'no', 'unknown']),
    hypervisor: z.enum(['yes', 'no']),
    /** `/dev/kvm` present, module loaded, CPU support, openable. */
    usable: z.boolean(),
    /** The node spec opts the node out (`virtualization.kvm: disabled`): no KVM levels whatever the facts. */
    optOut: z.boolean(),
  })
  .strict();
export type KvmFacts = z.infer<typeof kvmFactsSchema>;

/**
 * What a node can do (3.1). `runtimes` lists the isolation levels whose probe passed; the scheduler places a workload
 * only on nodes where its exact level is ready (never up- or downgraded).
 */
export const nodeCapabilitiesSchema = z
  .object({
    runtimes: z.array(z.enum(RUNTIMES_WIRE)),
    sandboxProbe: z.enum(['ready', 'missing', 'failed', 'unknown']),
    wireguard: z.boolean(),
    nftables: z.boolean(),
    bird: z.boolean(),
    drbd: z.boolean(),
    criu: z.boolean(),
    dockerVersion: z.string().max(64).optional(),
    /**
     * Checkpoint / restore support for live migration (3.10, protocol v2): CRIU through runc (with Docker's runc
     * root), gVisor's `runsc checkpoint` / `restore`.
     */
    checkpoint: z
      .object({
        runc: z.boolean(),
        runsc: z.boolean(),
        criuVersion: z.string().max(32).optional(),
        /** gVisor on the KVM platform can checkpoint / restore (restore must use the same platform). */
        runscKvm: z.boolean().optional(),
      })
      .strict()
      .optional(),
    /** Estimated node-to-node transfer rate (bits / s, e.g. the uplink speed), for the freeze estimate. */
    transferBitsPerSecond: z.number().int().positive().max(1e12).optional(),
    /**
     * A DRBD kernel module of version 9 or later is loaded or loadable (3.5): required for every Loadweaver volume.
     * Agents before this field don't report it (unknown: the control plane places volumes there with a warning).
     */
    drbd9: z.boolean().optional(),
    /** Probe result per isolation level (3.1); `runtimes` = the levels with state `ready`. */
    isolation: z.partialRecord(z.enum(RUNTIMES_WIRE), isolationProbeSchema).optional(),
    /** KVM facts and the opt-out (3.1). */
    kvm: kvmFactsSchema.optional(),
    /** The shared microVM launcher on this node (3.35): pinned digest, image unpack cache, thin pool for upper layers. */
    microvm: z
      .object({
        launcherDigest: z.string().max(100),
        unpackCache: z.boolean(),
        thinPool: z.boolean(),
        /** Live migration support of the launcher (M7 W10b): modes and QEMU / virtiofsd versions from its labels. */
        migration: z
          .object({
            generic: z.boolean(),
            modes: z.array(z.string().max(16)).max(8),
            qemu: z.string().max(64).optional(),
            virtiofsd: z.string().max(64).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    /**
     * Generic microVMs live-migrate through QEMU (M7 W10b): microVM level ready, launcher with virtio-fs state
     * migration (QEMU >= 10.0, virtiofsd >= 1.13). Both nodes need it; otherwise short stop / blue-green.
     */
    microvmMigration: z.boolean().optional(),
    /**
     * Bundled microVMs (Agenstra's images, their own launcher with an incoming mode) live-migrate through this agent
     * (M7 F5): microVM level ready. Both nodes need it; otherwise short stop / blue-green.
     */
    microvmBundledMigration: z.boolean().optional(),
    /** Full VMs are possible: microVM ready, DRBD 9 and UEFI firmware in the launcher (3.35). */
    virtualMachines: z.boolean().optional(),
    /** Hash of the host CPU's flags: `host-passthrough` VMs live-migrate only between identical values (3.35). */
    cpuFlagsHash: z
      .string()
      .regex(/^[0-9a-f]{16,64}$/)
      .optional(),
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
    /**
     * Agent-protocol version the agent speaks (`PROTOCOL_VERSION`, 3.26). Agents built before versioning don't send
     * it and are treated as version 0 without features.
     */
    protocolVersion: z.number().int().min(1).max(65_535).optional(),
    /**
     * Optional protocol features the agent understands; the control plane only sends fields gated by a feature to
     * nodes that advertise it. Ids the control plane doesn't know (a newer agent) are ignored, so any well-formed id
     * is accepted here.
     */
    features: z.array(protocolFeatureId).max(128).optional(),
    /**
     * The host's kernel node name (`uname -n`); DRBD resource files name each replica's host by it (3.5). Agents
     * before this field don't send it (the control plane falls back to the node name).
     */
    hostname: kernelHostnameSchema.optional(),
    /** What the node runs (3.26): release, platform images, kernel, pinned packages, gVisor, DRBD. */
    components: componentVersionsSchema.optional(),
  })
  .strict();
export type AgentHello = z.infer<typeof agentHelloSchema>;

/**
 * Changed capabilities on the open stream (feature `capability-updates`, M7): the isolation probes changed what the
 * node can run. Replaces the node's capabilities like a hello would, without a new stream (open live sessions stay).
 * Only sent when the control plane announced the feature (`helloAck`); otherwise the agent sends a fresh hello.
 */
export const capabilitiesUpdateSchema = z.object({ capabilities: nodeCapabilitiesSchema }).strict();
export type CapabilitiesUpdate = z.infer<typeof capabilitiesUpdateSchema>;

/**
 * The control plane's answer to a hello (feature `capability-updates`, M7): its protocol version and the features it
 * knows, so the agent can use agent → control plane messages a control plane one release behind wouldn't accept.
 */
export const helloAckSchema = z
  .object({
    protocolVersion: z.number().int().min(1).max(65_535),
    features: z.array(protocolFeatureId).max(128),
  })
  .strict();
export type HelloAck = z.infer<typeof helloAckSchema>;

export const heartbeatSchema = z
  .object({
    appliedRevision: z.number().int().nonnegative(),
    usage: resourceAmountsSchema,
    at: z.string().datetime(),
    /** Containers on the node Loadweaver doesn't manage (e.g. `docker run`): drift, reported, never touched (3.8). */
    foreign: z
      .object({
        containers: z
          .array(
            z
              .object({
                id: z.string().regex(/^[0-9a-f]{12,64}$/),
                name: z.string().max(128),
                image: z.string().max(512),
                state: z.string().max(32),
                ports: z.array(z.string().max(64)).max(64),
                /**
                 * Started by a workload that controls the node's Docker (docker.sock bind, an acknowledged pin) and
                 * carrying one of the label prefixes it declares (`loadweaver.com/delegates`, e.g. Agenstra's
                 * `io.agenstra.`): that replica's id. Delegated, not drift.
                 */
                delegatedTo: z.string().max(256).optional(),
              })
              .strict(),
          )
          .max(200),
      })
      .strict()
      .optional(),
    /** Component versions and update progress (3.26); hosts change them without reconnecting (OS updates). */
    components: componentVersionsSchema.optional(),
    /**
     * Whether the node holds etcd data (a non-empty etcd data directory, 3.43): the control plane lets a member
     * bootstrap etcd only while no member does (`controlPlane.etcd`). Sent to control planes with `etcd-bootstrap`.
     */
    etcd: z.object({ hasData: z.boolean() }).strict().optional(),
    /**
     * The last time this member fenced its Postgres data (3.43 takeover): the epoch it was fenced for, the epoch of the
     * moved-aside data, where it went and the export of the rows written there after the takeover (never merged). Sent
     * to control planes with `database-fencing`, the same report until the next fence (the control plane records it
     * once).
     */
    databaseFence: z
      .object({
        epoch: z.number().int().min(0),
        dataEpoch: z.number().int().min(0),
        at: z.string().datetime(),
        dataDir: z.string().max(512),
        exportDir: z.string().max(512).optional(),
        exportBytes: z.number().int().min(0).optional(),
        exportRows: z.number().int().min(0).optional(),
        exportError: z.string().max(500).optional(),
      })
      .strict()
      .optional(),
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
                /** Per-source settings from policies (feature `egress-policies`); absent: the node-level ones. */
                mode: z.enum(['monitor', 'enforce', 'offline']).optional(),
                blockPrivateNetworks: z.boolean().optional(),
                blockIpLiterals: z.boolean().optional(),
                logAllowed: z.boolean().optional(),
                denyUrlRegexes: z.array(egressUrlRegex).max(500).optional(),
                denyCidrs: z.array(egressCidrRule).max(5000).optional(),
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

/** Gateway credential of one platform-backup client on a member (3.20); the secret only on the wire. */
const platformBackupCredentialSchema = z
  .object({
    accessKeyId: z.string().regex(/^[A-Z0-9]{16,64}$/),
    secretAccessKey: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  .strict();

/** Control-plane member configuration for etcd + Patroni on this node (3.2). */
export const controlPlaneRoleSchema = z
  .object({
    role: z.enum(['none', 'member', 'witness']),
    members: z.array(
      z
        .object({
          name,
          address: z.string().max(64),
          witness: z.boolean(),
          /**
           * The member drains (2026-10-26): it stays a member, hands the Postgres leadership to another member and is
           * the last choice for agent streams. Absent from older control planes.
           */
          draining: z.boolean().optional(),
        })
        .strict(),
    ),
    /** Automatic failover needs a quorum; 2 members without witness need a manual confirm (3.2). */
    automaticFailover: z.boolean(),
    /**
     * How a voter with an empty etcd data directory starts (3.43, feature `etcd-bootstrap`): `bootstrap` for the one
     * member the control plane picked while no voter holds etcd data (a new cluster of itself), otherwise it joins
     * through `peers` (voters holding etcd data) and never bootstraps on its own. Absent from older control planes.
     */
    etcd: z
      .object({
        bootstrap: z.boolean(),
        peers: z.array(name).max(16),
      })
      .strict()
      .optional(),
    /**
     * Whether the cluster's database exists on the members yet (3.43, feature `database-handover`): an external control
     * plane (built-in setup) sends `pending` until it has handed its database over; the member then runs etcd, Patroni,
     * the log store, object store and registry, but not the control-plane API replica. Absent: ready (on-node installs,
     * older control planes).
     */
    database: z.enum(['pending', 'ready']).optional(),
    /**
     * Fencing of the cluster's database (3.43 takeover, feature `database-fencing`): `epoch` grows with every takeover
     * by the built-in control plane and every handover to the members. A member whose Postgres data belongs to an older
     * epoch (its `lw_database_handover.epoch`) must not act as primary: it stops its API replica, exports the rows
     * written after `takenOverAt`, moves its data aside and starts empty in `scope` (the Patroni scope chosen at the
     * takeover). A role with a lower epoch than one the agent has seen is stale and not applied. Absent from older
     * control planes.
     */
    databaseFence: z
      .object({
        epoch: z.number().int().min(0),
        takenOverAt: z.string().datetime().optional(),
        scope: z
          .string()
          .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/)
          .optional(),
      })
      .strict()
      .optional(),
    /** Patroni / etcd scope (the cluster id). */
    scope: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/),
    /**
     * Patroni scope of the control-plane database when it differs from `scope` (after a point-in-time cut-over,
     * 3.20; feature `platform-cutover`). Members keep the scope their data belongs to (a marker next to the data
     * directory) and change it only through `platformBackups.postgresCutover`; this is for members starting fresh.
     */
    postgresScope: z
      .string()
      .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/)
      .optional(),
    /**
     * Configuration shared by all control-plane members (database credentials, encryption key, auth settings).
     * Only sent to members, over the authenticated stream; written 0600 on the node, never logged.
     */
    environment: z.record(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), z.string().max(8192)).optional(),
    /** OpenSearch for logs on the members (3.14): one node per member, discovering the others over the overlay. */
    logStore: z
      .object({
        clusterName: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/),
        heapMb: z.number().int().min(256).max(31_744),
        httpPort: z.number().int().min(1024).max(65535),
        transportPort: z.number().int().min(1024).max(65535),
      })
      .strict()
      .optional(),
    /**
     * Backups of the control plane's own data (3.20), gated by `platform-backups`: WAL-G in Spilo and the OpenSearch
     * snapshot repository write through the S3 gateway of the member's own control-plane API (loopback) with
     * per-member gateway credentials; the secrets are added at push time only.
     */
    platformBackups: z
      .object({
        gatewayPort: z.number().int().min(1024).max(65535),
        bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
        region: z.string().regex(/^[a-z0-9-]{1,63}$/),
        postgres: platformBackupCredentialSchema.optional(),
        opensearch: platformBackupCredentialSchema.optional(),
        /** Point-in-time restore of Postgres into a new Patroni scope, side by side on this member (3.20). */
        postgresClone: z
          .object({
            id: z.string().regex(/^[a-z0-9-]{1,36}$/),
            scope: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/),
            sourceScope: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/),
            /** ISO 8601 with offset; empty = latest (end of the archive). */
            targetTime: z.string().max(40),
            pgPort: z.number().int().min(1024).max(65535),
            apiPort: z.number().int().min(1024).max(65535),
          })
          .strict()
          .optional(),
        /**
         * Cut-over to a point-in-time clone (3.20, feature `platform-cutover`): `node` adopts its clone of restore
         * `id` as its database (the clone's data directory becomes the member's), every other member moves its data
         * aside and starts again as a replica in `scope`. Only members whose data still belongs to `previousScope`
         * act on it.
         */
        postgresCutover: z
          .object({
            id: z.string().regex(/^[a-z0-9-]{1,36}$/),
            scope: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/),
            previousScope: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/),
            node: name,
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    /**
     * The member's Postgres server certificate from the cluster CA (feature `postgres-tls`): Spilo serves it, the API
     * verifies it (cluster CA, `POSTGRES_TLS_SERVER_NAME`). Issued at push time only; the agent keeps the one it has
     * until it needs a new one (other CA, address, a third of its lifetime left).
     */
    postgresTls: z
      .object({
        certificatePem: z.string().max(16_384),
        privateKeyPem: z.string().max(16_384),
        caCertificatePem: z.string().max(16_384),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ControlPlaneRole = z.infer<typeof controlPlaneRoleSchema>;
export type PostgresTls = NonNullable<ControlPlaneRole['postgresTls']>;
/** DNS name in every member's Postgres server certificate; the API checks it (it connects through the leader proxy). */
export const POSTGRES_TLS_SERVER_NAME = 'postgres.loadweaver';
export type PlatformBackupsRole = NonNullable<ControlPlaneRole['platformBackups']>;
export type PostgresCutover = NonNullable<PlatformBackupsRole['postgresCutover']>;

const portSchema = z.number().int().min(1).max(65535);
const absolutePath = z
  .string()
  .regex(/^\/[^\0]*$/)
  .max(4096);
const secretRefSchema = z.string().regex(/^secret:\/\/[a-z0-9-]+\/[a-z0-9][a-z0-9._-]*(@\d+)?$/);
const hostRouteSchema = z
  .string()
  .max(64)
  .refine((v) => isCidr(v) && v.endsWith(v.includes(':') ? '/128' : '/32'), 'host route expected');

/**
 * Levels above the Docker family of `workloads[].runtime` (feature `isolation-ladder`): `sandboxed-kvm` runs with
 * `runtime: sandboxed` (gVisor on the KVM platform), `microvm` with `runtime: runc` (the launcher runs on runc).
 */
export const WORKLOAD_ISOLATION_LEVELS = ['sandboxed-kvm', 'microvm'] as const;

/** A workload's MAC address: QEMU's locally administered prefix 52:54:00 + 3 bytes (derived from the VM uid). */
export const vmMacSchema = z.string().regex(/^52:54:00(:[0-9a-f]{2}){3}$/, 'invalid VM MAC address');

/** A generic microVM's guest root: digest-pinned image layers (verified while unpacking) and its process. */
/** One image layer of a generic microVM's guest root (verified while unpacking). */
const microvmLayerSchema = z
  .object({
    digest: sha256RefSchema,
    diffId: sha256RefSchema,
    size: z.number().int().nonnegative(),
    mediaType: z.string().max(128),
  })
  .strict();

/** Node architectures a microVM guest image can be unpacked for (the node picks its own). */
export const MICROVM_ARCHITECTURES = ['amd64', 'arm64'] as const;
export type MicrovmArchitecture = (typeof MICROVM_ARCHITECTURES)[number];

const microvmSpecSchema = z
  .object({
    /** `bundled`: the image carries Agenstra's microVM label and is its own launcher; `generic`: the image is the guest root. */
    mode: z.enum(['bundled', 'generic']),
    /** Generic: the digest-pinned service image (what is scanned and policy-checked); `image` is then the launcher. */
    guestImage: z.string().max(512).optional(),
    /** Single-architecture images: the layers (base first). Multi-arch images use `platformLayers`. */
    layers: z.array(microvmLayerSchema).max(128).optional(),
    /**
     * Layers per node architecture (multi-arch guest images; mixed-arch clusters): the node unpacks its own
     * architecture's list and refuses the workload when it is missing. Takes precedence over `layers`.
     */
    platformLayers: z.partialRecord(z.enum(MICROVM_ARCHITECTURES), z.array(microvmLayerSchema).max(128)).optional(),
    /** Image config merged with the compose overrides. */
    process: z
      .object({
        entrypoint: z.array(z.string().max(8192)).max(256),
        cmd: z.array(z.string().max(8192)).max(256),
        env: z.array(z.string().max(32768)).max(1024),
        user: z.string().max(64),
        workingDir: absolutePath,
        stopSignal: z.string().max(16),
      })
      .strict()
      .optional(),
    vcpus: z.number().int().min(1).max(64),
    memoryMiB: z.number().int().min(128).max(1_048_576),
    /** Per-replica writable layer quota. */
    rootfsBytes: z.number().int().positive(),
  })
  .strict();

/** One guest network interface of a full VM (one or more per VM, M7). */
const vmNicWireSchema = z
  .object({
    /** Interface name in the guest (cloud-init `match` is by MAC). */
    name: z.string().regex(/^[a-z][a-z0-9]{0,14}$/),
    mac: vmMacSchema,
    /** The NIC's addresses; the first NIC's equal the workload's `addresses`. */
    addresses: z.array(ipAddress).min(1).max(2),
    /**
     * Kept addresses after a live migration (as `workloads[].hostRoutes`) for NICs after the first; the first NIC uses
     * the workload's `hostRoutes`.
     */
    hostRoutes: z.array(hostRouteSchema).max(2).optional(),
  })
  .strict();

/** A full VM (3.35, feature `virtual-machines`): the launcher runs it from DRBD block disks. */
const vmSpecSchema = z
  .object({
    uid: z.string().uuid(),
    firmware: z.enum(['uefi', 'bios']),
    cpuModel: z.enum(['host-model', 'host-passthrough']),
    vcpus: z.number().int().min(1).max(64),
    memoryMiB: z.number().int().min(256).max(1_048_576),
    /** Boot disk first; each disk is a `volumes[]` assignment with `mode: block`. */
    disks: z
      .array(
        z
          .object({
            name: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/),
            volume: volumeIdSchema,
            bus: z.literal('virtio'),
            cache: z.enum(['none', 'writeback']),
            boot: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    /** One or more NICs; the first is the primary one (default route). */
    nics: z.array(vmNicWireSchema).min(1).max(8),
    image: vmImageRefSchema,
    /**
     * NoCloud seed (built on tmpfs by the launcher at every start). Outside the spec hash except `metaData`'s
     * instance-id: a user-data change doesn't recreate the VM. `secretRefs` are resolved through the secret broker.
     */
    cloudInit: z
      .object({
        metaData: z.string().max(4096),
        networkConfig: z.string().max(16_384).optional(),
        userData: z.string().max(65_536).optional(),
        secretRefs: z.array(secretRefSchema).max(32),
      })
      .strict()
      .optional(),
    graphics: z.boolean(),
    power: z.enum(['running', 'stopped']),
  })
  .strict();

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
    /**
     * Live migration (3.10, feature `live-migration`, outside the spec hash): the replica was restored from a
     * checkpoint on this node and runs as an agent-managed runc / runsc container; the agent adopts it instead of
     * creating a Docker container, until its next restart (then it is created through Docker as usual).
     */
    restoredFrom: z
      .object({ migration: z.string().uuid(), runtime: z.enum(['runc', 'runsc']) })
      .strict()
      .optional(),
    /**
     * Live migration (feature `live-migration`, outside the spec hash): addresses the replica kept from another
     * node's pod subnet, as host routes (`/32`, `/128`). The node's IPAM plugin assigns them from the cluster pod
     * supernet and routes them to the container; BIRD originates them (`network.bgp.originate`).
     */
    hostRoutes: z.array(hostRouteSchema).max(2).optional(),
    /**
     * Isolation level above the Docker family of `runtime` (3.1, feature `isolation-ladder`, refuse-gated): only
     * emitted for `sandboxed-kvm` (with `runtime: sandboxed`) and `microvm` (with `runtime: runc`), so existing
     * replicas keep their spec hash. The workload runs at exactly this level.
     */
    isolation: z.enum(WORKLOAD_ISOLATION_LEVELS).optional(),
    /** Allow-listed host devices (3.1, feature `workload-devices`, refuse-gated); only emitted when non-empty. */
    devices: z
      .array(z.object({ path: z.literal('/dev/kvm'), permissions: z.enum(['rw', 'rwm']).default('rwm') }).strict())
      .max(4)
      .optional(),
    /** MicroVM workload (3.35, feature `microvm`, refuse-gated): with `isolation: microvm`. */
    microvm: microvmSpecSchema.optional(),
    /** Full VM (3.35, feature `virtual-machines`, refuse-gated): with `isolation: microvm`, `image` = the launcher. */
    vm: vmSpecSchema.optional(),
  })
  .strict();
export type WorkloadSpec = z.infer<typeof workloadSpecSchema>;
export type MicrovmSpec = z.infer<typeof microvmSpecSchema>;
export type VmSpec = z.infer<typeof vmSpecSchema>;
export type VmNicSpec = z.infer<typeof vmNicWireSchema>;

/** The isolation level a workload runs at: `isolation` when set, else its Docker family (`runtime`). */
export function workloadIsolationLevel(spec: Pick<WorkloadSpec, 'runtime' | 'isolation'>): RuntimeWire {
  return spec.isolation ?? spec.runtime;
}

/** The Docker family (`workloads[].runtime`) of a level: `sandboxed-kvm` → `sandboxed`, `microvm` → `runc`. */
export function dockerRuntimeFamily(level: RuntimeWire): WorkloadSpec['runtime'] {
  if (level === 'sandboxed-kvm') return 'sandboxed';

  return level === 'microvm' ? 'runc' : level;
}

/** To the target of a live migration (3.10): `migrationPrepare` with the spec the replica runs there. */
export const migrationPrepareSchema = migrationPrepareBaseSchema.extend({ spec: workloadSpecSchema }).strict();
export type MigrationPrepare = z.infer<typeof migrationPrepareSchema>;

/** To the target of a QEMU live migration (3.35, feature `vm-migration`): `vmMigrationPrepare` with the spec. */
export const vmMigrationPrepareSchema = vmMigrationPrepareBaseSchema.extend({ spec: workloadSpecSchema }).strict();
export type VmMigrationPrepare = z.infer<typeof vmMigrationPrepareSchema>;

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
      .array(
        z
          .object({
            node: name,
            nodeId: z.number().int().min(0).max(31),
            address: ipAddress,
            /**
             * The replica host's kernel node name, which DRBD's `on` sections must match (feature `drbd-hostnames`);
             * without it the agent uses the node name.
             */
            host: kernelHostnameSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    /** Replication per node pair: C (synchronous, same site) or A (asynchronous, across sites). */
    connections: z.array(z.object({ a: name, b: name, protocol: z.enum(['A', 'C']) }).strict()),
    /** Where the volume's workload runs; only that node promotes it. */
    primary: name,
    /** Secret reference of the LUKS key (3.22: all volumes are encrypted at rest). */
    keyRef: z.string().regex(/^secret:\/\/[a-z0-9-]+\/[a-z0-9][a-z0-9._-]*(@\d+)?$/),
    /**
     * A VM disk (3.35, feature `vm-block-volumes`, refuse-gated): no filesystem, the DRBD device is passed to the
     * launcher as a virtio-blk disk. Absent: a filesystem volume.
     */
    mode: z.literal('block').optional(),
    /** Block volumes: initialize from this VM image disk layer once, when first promoted (feature `vm-block-volumes`). */
    initializeFrom: z
      .object({ digest: sha256RefSchema, format: z.enum(['qcow2', 'raw']) })
      .strict()
      .optional(),
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
                    /** Replaces the matched prefix before forwarding (platform pages such as status pages, 3.25). */
                    rewrite: z
                      .string()
                      .regex(/^\/[A-Za-z0-9_./-]*$/)
                      .max(256)
                      .optional(),
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
    /** Live access the node allows (3.19): a root shell on the host only if the cluster enables it. */
    liveAccess: z.object({ nodeShell: z.boolean() }).strict().optional(),
    /** Endpoint probes this node runs (DNS failover). */
    probes: z.array(probeSchema).max(1024).optional(),
    /** Rate-limit service on control-plane members. */
    rateLimiter: rateLimiterSchema.optional(),
    /** Draining nodes stop accepting work; agents keep running until left (3.12). */
    lifecycle: z.enum(['active', 'cordoned', 'draining', 'leaving']),
    /** The release this node runs and its update steps (3.26, feature `components`). */
    components: nodeComponentsSchema.optional(),
    /** Backup repository servers on control-plane members (3.20, feature `backups`). */
    backupServer: backupServerRoleSchema.optional(),
    /**
     * Host settings (3.1, feature `isolation-ladder`, stripped for nodes without it): `kvm: disabled` is the node
     * spec's KVM opt-out (no KVM preparation, no KVM levels); a new `probeNonce` re-runs the isolation probes.
     */
    host: z
      .object({
        kvm: z.enum(['auto', 'disabled']).optional(),
        probeNonce: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,64}$/)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type DesiredState = z.infer<typeof desiredStateSchema>;

export const applyStepSchema = z
  .object({
    layer: z.enum([
      // Release components (3.26): the verified release whose images the node runs from here on.
      'components',
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
      // Backup repository servers (3.20, feature `backups`).
      'backups',
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

export { LOG_SOURCES, type LogSource } from '@forepath/loadweaver/shared/util-model';

const labelValue = z.string().max(253);

/** One log line, enriched on the node with the identifiers of the policy model (3.14). */
export const logEntrySchema = z
  .object({
    at: z.string().datetime(),
    source: z.enum(LOG_SOURCES),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string().max(16_384),
    labels: z
      .object({
        project: labelValue.optional(),
        deployment: labelValue.optional(),
        service: labelValue.optional(),
        replica: labelValue.optional(),
        policy: labelValue.optional(),
        peer: labelValue.optional(),
        component: labelValue.optional(),
        stream: z.enum(['stdout', 'stderr']).optional(),
      })
      .strict(),
    fields: z
      .record(z.string().regex(/^[a-z][a-zA-Z0-9_]{0,63}$/), z.union([z.string().max(1024), z.number(), z.boolean()]))
      .optional(),
  })
  .strict();
export type LogEntry = z.infer<typeof logEntrySchema>;

/** Log lines shipped off the node right away, so they survive it (3.14). */
export const logBatchSchema = z
  .object({
    entries: z.array(logEntrySchema).max(1000),
    /** Lines the node had to drop because its buffer was full while disconnected. */
    dropped: z.number().int().nonnegative().optional(),
  })
  .strict();
export type LogBatch = z.infer<typeof logBatchSchema>;

const metricEntity = z.string().max(255);

/**
 * The node's 10 s metrics and aggregated flows (3.18): samples per metric and entity (node, interface, WireGuard
 * peer, replica, hostname), flows per policy edge and decision. Aggregated on the node, so volume follows the number
 * of series, not traffic.
 */
export const metricsReportSchema = z
  .object({
    at: z.string().datetime(),
    samples: z
      .array(
        z
          .object({
            metric: z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/),
            entity: metricEntity,
            project: z
              .string()
              .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/)
              .optional(),
            value: z.number().finite(),
          })
          .strict(),
      )
      .max(10_000),
    flows: z
      .array(
        z
          .object({
            policy: z.string().max(255),
            src: metricEntity,
            dst: metricEntity,
            protocol: z.enum(['tcp', 'udp', 'icmp', 'any']),
            port: z.number().int().min(0).max(65535),
            decision: z.enum(['allowed', 'denied', 'observed']),
            packets: z.number().int().nonnegative(),
            bytes: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict();
export type MetricsReport = z.infer<typeof metricsReportSchema>;

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

/** A full VM's guest power state (libvirt `domstate`, normalized), in `workloadStatus`. */
export const VM_POWER_STATES = [
  'running',
  'paused',
  'shutting-down',
  'shut-off',
  'crashed',
  'suspended',
  'unknown',
] as const;
export type VmPowerState = (typeof VM_POWER_STATES)[number];

/**
 * Progress of a boot disk import (3.35): `queued` (the node's import slots are busy), `fetching` (the image layer
 * into the node's cache; `bytes` downloaded, total unknown), `writing` (`qemu-img convert` onto the disk; `bytes` of
 * `totalBytes` = the image's virtual size), `failed` (retried later; the message says why).
 */
export const VM_IMPORT_PHASES = ['queued', 'fetching', 'writing', 'failed'] as const;
export const vmImportProgressSchema = z
  .object({
    phase: z.enum(VM_IMPORT_PHASES),
    bytes: z.number().int().nonnegative().optional(),
    totalBytes: z.number().int().nonnegative().optional(),
  })
  .strict();
export type VmImportProgress = z.infer<typeof vmImportProgressSchema>;

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
          /**
           * Full VMs (3.35, agents with `virtual-machines`): the guest's power state as libvirt reports it in the
           * launcher, and `importing` while the boot disk is written from its image (no container yet; a background
           * job on the node), with its progress in `importProgress` (also `failed` until the retry). Optional, so
           * older control planes ignore it.
           */
          vm: z
            .object({
              power: z.enum(VM_POWER_STATES).optional(),
              importing: z.boolean().optional(),
              importProgress: vmImportProgressSchema.optional(),
            })
            .strict()
            .optional(),
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
    /**
     * The VM node command this event reports the outcome of (3.35): `vmPower` with its `action`, `vmImageImport`
     * with its `importId`. Optional (older agents only label the events); the control plane prefers it to the labels
     * / message prefix and ignores values it doesn't know.
     */
    vmCommand: z
      .object({
        type: z.string().max(32),
        action: z.string().max(32).optional(),
        importId: z.string().max(64).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type AgentEvent = z.infer<typeof agentEventSchema>;

export const errorMessageSchema = z.object({ code: z.string().max(64), message: z.string().max(2048) }).strict();

/** All message types and their payload schemas, per direction. */
export const AGENT_TO_CONTROL_PLANE = {
  hello: agentHelloSchema,
  heartbeat: heartbeatSchema,
  /** Changed capabilities without a new hello (feature `capability-updates`). */
  capabilitiesUpdate: capabilitiesUpdateSchema,
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
  logBatch: logBatchSchema,
  metrics: metricsReportSchema,
  // Live sessions (3.19), on their envelope channel.
  execOutput: execOutputSchema,
  execExit: execExitSchema,
  fileResponse: fileResponseSchema,
  tunnelData: tunnelDataSchema,
  tunnelClose: tunnelCloseSchema,
  /** Live migration progress (3.10, protocol v2), on the session's channel. */
  migrationProgress: migrationProgressSchema,
  /** Backup / restore progress (3.20, feature `backups`), on the command's channel. */
  backupProgress: backupProgressSchema,
  /** A fresh discovery report of a pending node (3.21, feature `node-import`). */
  discoveryReport: discoveryResultSchema,
  /** Join-plan step progress (3.21, feature `node-import`), on the import's channel. */
  importProgress: importProgressSchema,
  error: errorMessageSchema,
} as const;

/** The control plane stored a log batch (`ok`) or couldn't (the node keeps and resends it), 3.14. */
export const logAckSchema = z.object({ ok: z.boolean() }).strict();

export const CONTROL_PLANE_TO_AGENT = {
  logAck: logAckSchema,
  /** The control plane's features, answered to a hello (gated by `capability-updates`). */
  helloAck: helloAckSchema,
  desiredState: desiredStateSchema,
  certificateIssued: certificateIssuedSchema,
  secretValue: secretValueSchema,
  unsealShareRequest: unsealShareRequestSchema,
  registryToken: registryTokenSchema,
  workloadIdentities: workloadIdentitiesSchema,
  execOpen: execOpenSchema,
  execInput: execInputSchema,
  execResize: execResizeSchema,
  execClose: execCloseSchema,
  fileRequest: fileRequestSchema,
  tunnelOpen: tunnelOpenSchema,
  tunnelData: tunnelDataSchema,
  tunnelClose: tunnelCloseSchema,
  /** Live migration sessions (3.10, protocol v2, gated by `live-migration`), on their channel. */
  migrationPrepare: migrationPrepareSchema,
  migrationPrecopy: migrationPrecopySchema,
  migrationFreeze: migrationFreezeSchema,
  migrationRestore: migrationRestoreSchema,
  migrationCommit: migrationCommitSchema,
  migrationAbort: migrationAbortSchema,
  /** Backups (3.20, protocol v2, gated by `backups`), on their channel. */
  backupRun: backupRunSchema,
  restoreRun: restoreRunSchema,
  /** Import of existing hosts (3.21, protocol v2, gated by `node-import`). */
  discoveryRequest: discoveryRequestSchema,
  importStep: importStepCommandSchema,
  /** Serial / VNC consoles of VMs (3.35, gated by `vm-consoles`), on a live channel. */
  consoleOpen: consoleOpenSchema,
  /** VM power actions and re-imaging (3.35, gated by `virtual-machines`). */
  vmPower: vmPowerSchema,
  vmImageImport: vmImageImportSchema,
  /** QEMU live migration (3.35, gated by `vm-migration`), on the session's channel. */
  vmMigrationPrepare: vmMigrationPrepareSchema,
  vmMigrationStart: vmMigrationStartSchema,
  vmMigrationSwitchover: vmMigrationSwitchoverSchema,
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
    /**
     * Join for an import (3.21): the node joins as `pending` (no desired state, nothing changes on the host) and
     * `discovery` carries its read-only discovery report for the import wizard.
     */
    discover: z.literal(true).optional(),
    discovery: discoveryReportSchema.optional(),
  })
  .strict()
  .refine((r) => !r.discover || !!r.discovery, { message: 'discover needs a discovery report', path: ['discovery'] });
export type JoinRequest = z.infer<typeof joinRequestSchema>;

export const joinResponseSchema = z
  .object({
    clusterId: z.string(),
    nodeName: name,
    certificatePem: z.string(),
    caCertificatePem: z.string(),
    /** gRPC endpoints of the control plane (`host:port`), tried in order. */
    controlPlaneEndpoints: z.array(z.string()),
    /** Joined for an import: pending until its join plan is applied (only answered to `discover` requests). */
    pending: z.literal(true).optional(),
  })
  .strict();
export type JoinResponse = z.infer<typeof joinResponseSchema>;

export type NodeNetworkConfig = z.infer<typeof nodeNetworkConfigSchema>;
