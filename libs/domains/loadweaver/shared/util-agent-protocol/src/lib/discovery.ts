import { isMap, isPair, isScalar, isSeq, parseDocument, visit, type Node as YamlNode } from 'yaml';
import { z } from 'zod';

/**
 * Import of existing Docker hosts and former nodes (3.21, protocol v2, feature `node-import`).
 *
 * Discovery is read-only: the agent (`loadweaver-agent discover`, installer `--discover`) reads compose projects,
 * containers, volumes, networks, listeners, interfaces, routes, VPN interfaces, nftables tables and the markers of
 * a former Loadweaver installation, and sends the report with its join request (`JoinRequest.discovery`, the node
 * joins as `pending` and gets no desired state) or, when the control plane asks again, as `discoveryReport` on the
 * stream. Values of `.env` variables whose names look sensitive never leave the host (`sensitive: true`, no value).
 *
 * The approved join plan drives the node through `importStep` commands (channel `import:<id>`, idempotent per step
 * id, re-sent until reported): install the node components, copy volume data (rsync pre-copy, final pass during a
 * short stop), stop / restart the source containers, hand their ports over, wipe a former cluster identity. The
 * agent reports `importProgress` on the same channel.
 */

export const IMPORT_CHANNEL_PREFIX = 'import:';

export function importChannel(id: string): string {
  return `${IMPORT_CHANNEL_PREFIX}${id}`;
}

export const DISCOVERY_REPORT_VERSION = 1;

/** Variable names whose values are treated as secrets and never reported. */
export const SENSITIVE_VARIABLE = /(PASS|SECRET|TOKEN|KEY|CREDENTIAL|PRIVATE|AUTH|CERT|SALT|DSN|COOKIE|URL|URI|CONN)/i;

/** Credentials in a URL (`scheme://user:password@host`, `redis://:password@host`). */
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]*):([^\s/@]+)@/gi;

/** A value carries URL credentials (`postgres://app:pw@db/app`). */
export function hasUrlCredentials(value: string): boolean {
  return [...value.matchAll(URL_USERINFO)].some((m) => !PLACEHOLDER.test(m[3]));
}

/** A password that is only an interpolation (`${DB_PASSWORD}`) is no credential. */
const PLACEHOLDER = /^\$\{[A-Za-z_][A-Za-z0-9_]*(:?[-?][^}]*)?\}$/;

/** A templated value without literal credentials (`postgres://app:${PW}@db`) stays as it is. */
function templated(value: string): boolean {
  return value.includes('${') && !hasUrlCredentials(value);
}

/** A variable whose value never leaves the host: a sensitive name, or URL credentials in the value. */
export function isSensitiveVariable(name: string, value = ''): boolean {
  return SENSITIVE_VARIABLE.test(name) || hasUrlCredentials(value);
}

/** Placeholder variable for a redacted value: compose interpolation asks for it in the import wizard. */
function placeholder(name: string): string {
  return '${' + name + '}';
}

export interface RedactedCompose {
  content: string;
  /** Variables the redacted values were replaced with, and where they were. */
  redacted: { variable: string; path: string }[];
}

/**
 * Redacts a compose file before it leaves the host (3.21): values of `environment` entries with sensitive names or
 * URL credentials become `${NAME}` (the wizard asks for them like `.env` secrets), and URL credentials anywhere else
 * become `${LW_REDACTED_<n>}`. Formatting and comments stay. Unparseable files are not reported at all (`null`).
 */
export function redactCompose(text: string): RedactedCompose | null {
  const doc = parseDocument(text, { merge: false, uniqueKeys: false });

  if (doc.errors.length > 0) return null;

  const redacted: RedactedCompose['redacted'] = [];
  const used = new Set<string>();
  let counter = 0;
  const fresh = (base: string) => {
    let name = base;

    while (used.has(name)) name = `${base}_${++counter}`;

    used.add(name);

    return name;
  };
  const services = doc.get('services', true) as YamlNode | undefined;

  if (isMap(services)) {
    for (const service of services.items) {
      const serviceName = String(isScalar(service.key) ? service.key.value : service.key);
      const env = isMap(service.value) ? (service.value.get('environment', true) as YamlNode | undefined) : undefined;

      if (isMap(env)) {
        for (const item of env.items) {
          const key = String(isScalar(item.key) ? item.key.value : item.key);
          const value = isScalar(item.value) ? item.value.value : null;

          if (value === null || value === undefined || !isScalar(item.value)) continue;

          const text = String(value);

          if (templated(text)) continue;

          if (isSensitiveVariable(key, text) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
            const variable = fresh(key);

            item.value.value = placeholder(variable);
            redacted.push({ variable, path: `services.${serviceName}.environment.${key}` });
          }
        }
      } else if (isSeq(env)) {
        env.items.forEach((entry, i) => {
          if (!isScalar(entry) || typeof entry.value !== 'string') return;

          const index = entry.value.indexOf('=');

          if (index < 0) return;

          const key = entry.value.slice(0, index);
          const value = entry.value.slice(index + 1);

          if (templated(value)) return;

          if (isSensitiveVariable(key, value) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
            const variable = fresh(key);

            entry.value = `${key}=${placeholder(variable)}`;
            redacted.push({ variable, path: `services.${serviceName}.environment[${i}]` });
          }
        });
      }
    }
  }

  // URL credentials anywhere else (commands, healthchecks, labels, extension fields).
  visit(doc, {
    Scalar(_key, node, path) {
      if (typeof node.value !== 'string' || !hasUrlCredentials(node.value)) return;

      const where = path
        .filter(isPair)
        .map((p) => String(isScalar(p.key) ? p.key.value : p.key))
        .join('.');

      node.value = node.value.replace(URL_USERINFO, (match: string, scheme: string, user: string, password: string) => {
        if (PLACEHOLDER.test(password)) return match;

        const variable = fresh(`LW_REDACTED_${redacted.length + 1}`);

        redacted.push({ variable, path: where });

        return `${scheme}${user}:${placeholder(variable)}@`;
      });
    },
  });

  return { content: doc.toString({ lineWidth: 0 }), redacted };
}

const shortText = z.string().max(256);
const absolutePath = z
  .string()
  .max(4096)
  .regex(/^\/[^\0]*$/, 'an absolute path');
const containerId = z.string().regex(/^[0-9a-f]{12,64}$/);
const portNumber = z.number().int().min(0).max(65535);
const cidrOrAddress = z.string().max(64);

export const discoveredPortSchema = z
  .object({
    protocol: z.enum(['tcp', 'udp', 'sctp']),
    hostIp: z.string().max(64),
    hostPort: portNumber,
    containerPort: portNumber,
  })
  .strict();
export type DiscoveredPort = z.infer<typeof discoveredPortSchema>;

export const discoveredMountSchema = z
  .object({
    type: z.enum(['volume', 'bind', 'tmpfs', 'other']),
    /** Volume name (type `volume`). */
    name: shortText.optional(),
    /** Host path: the volume's mount point or the bind source. */
    source: z.string().max(4096),
    destination: z.string().max(4096),
    readOnly: z.boolean(),
    /** The bind source is a directory (false: a file; missing: unknown). */
    directory: z.boolean().optional(),
  })
  .strict();
export type DiscoveredMount = z.infer<typeof discoveredMountSchema>;

export const discoveredContainerSchema = z
  .object({
    id: containerId,
    name: shortText,
    image: z.string().max(512),
    state: z.string().max(32),
    restartPolicy: z.string().max(32).optional(),
    ports: z.array(discoveredPortSchema).max(1024),
    mounts: z.array(discoveredMountSchema).max(256),
    networks: z.array(shortText).max(64),
    networkMode: z.string().max(256).optional(),
    privileged: z.boolean().optional(),
    /** Compose labels (`com.docker.compose.*`) and Loadweaver labels; nothing else (labels may hold secrets). */
    labels: z.record(z.string().max(256), z.string().max(1024)),
    compose: z
      .object({ project: shortText, service: shortText, number: z.number().int().min(0).optional() })
      .strict()
      .optional(),
    /** Started by Loadweaver (`loadweaver.com/managed`): a former node's workload, not a foreign container. */
    managed: z.boolean(),
  })
  .strict();
export type DiscoveredContainer = z.infer<typeof discoveredContainerSchema>;

export const discoveredEnvVariableSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    /** Left out for sensitive names (`SENSITIVE_VARIABLE`). */
    value: z.string().max(4096).optional(),
    sensitive: z.boolean(),
  })
  .strict();
export type DiscoveredEnvVariable = z.infer<typeof discoveredEnvVariableSchema>;

export const discoveredComposeProjectSchema = z
  .object({
    name: shortText,
    workingDir: z.string().max(4096).optional(),
    configFiles: z
      .array(
        z
          .object({
            path: z.string().max(4096),
            /** File content; missing when it could not be read or exceeded the report budget (`error`). */
            content: z
              .string()
              .max(256 * 1024)
              .optional(),
            /** Values replaced by `${VARIABLE}` placeholders before the file left the host (`redactCompose`). */
            redacted: z
              .array(
                z
                  .object({ variable: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), path: z.string().max(1024) })
                  .strict(),
              )
              .max(1024)
              .optional(),
            error: z.string().max(512).optional(),
          })
          .strict(),
      )
      .max(16),
    envFile: z
      .object({
        path: z.string().max(4096),
        variables: z.array(discoveredEnvVariableSchema).max(512),
        error: z.string().max(512).optional(),
      })
      .strict()
      .optional(),
    services: z.array(shortText).max(256),
    containers: z.array(containerId).max(1024),
  })
  .strict();
export type DiscoveredComposeProject = z.infer<typeof discoveredComposeProjectSchema>;

export const discoveredVolumeSchema = z
  .object({
    name: shortText,
    driver: shortText,
    mountpoint: z.string().max(4096),
    /** Bytes used (Docker's disk usage); null when unknown. */
    sizeBytes: z.number().int().nonnegative().nullable(),
    compose: z.object({ project: shortText, volume: shortText }).strict().optional(),
    /** Ids of the containers that mount it. */
    usedBy: z.array(containerId).max(1024),
  })
  .strict();
export type DiscoveredVolume = z.infer<typeof discoveredVolumeSchema>;

export const discoveredNetworkSchema = z
  .object({
    name: shortText,
    driver: shortText,
    subnets: z.array(cidrOrAddress).max(16),
    compose: z.object({ project: shortText, network: shortText }).strict().optional(),
  })
  .strict();
export type DiscoveredNetwork = z.infer<typeof discoveredNetworkSchema>;

export const discoveredListenerSchema = z
  .object({
    protocol: z.enum(['tcp', 'udp']),
    /** Local address, `0.0.0.0` / `::` / `*` for every address. */
    address: z.string().max(64),
    port: portNumber,
    process: z.string().max(128).optional(),
    pid: z.number().int().positive().optional(),
  })
  .strict();
export type DiscoveredListener = z.infer<typeof discoveredListenerSchema>;

export const discoveredInterfaceSchema = z
  .object({
    name: z.string().max(32),
    /** Link kind (`ip -d link`): `wireguard`, `tun`, `bridge`, `veth`, `vxlan`, `dummy`, `device`, `loopback`, … */
    kind: z.string().max(32),
    up: z.boolean(),
    addresses: z.array(cidrOrAddress).max(256),
  })
  .strict();
export type DiscoveredInterface = z.infer<typeof discoveredInterfaceSchema>;

export const discoveredRouteSchema = z
  .object({
    /** CIDR, or `default`. */
    destination: z.string().max(64),
    device: z.string().max(32).optional(),
    gateway: z.string().max(64).optional(),
    table: z.string().max(32).optional(),
    family: z.enum(['inet', 'inet6']),
  })
  .strict();
export type DiscoveredRoute = z.infer<typeof discoveredRouteSchema>;

export const discoveredVpnSchema = z
  .object({
    interface: z.string().max(32),
    kind: z.enum(['wireguard', 'tailscale', 'openvpn', 'ipsec', 'zerotier', 'other']),
    listenPort: portNumber.optional(),
  })
  .strict();
export type DiscoveredVpn = z.infer<typeof discoveredVpnSchema>;

export const discoveredDrbdResourceSchema = z
  .object({
    /** `lw-<minor>`. */
    name: z.string().regex(/^lw-\d{1,6}$/),
    minor: z.number().int().nonnegative(),
    port: portNumber.optional(),
    /** Host names of the `on` sections and their DRBD node ids. */
    hosts: z.array(z.object({ host: z.string().max(64), nodeId: z.number().int().min(0).max(31) }).strict()).max(32),
    /** The local backing device exists (thin LV `loadweaver/lw-<minor>`). */
    backingDevice: z.boolean(),
    sizeBytes: z.number().int().nonnegative().optional(),
    /** Resource is up: role and disk state from `drbdsetup status`. */
    role: z.string().max(32).optional(),
    diskState: z.string().max(32).optional(),
  })
  .strict();
export type DiscoveredDrbdResource = z.infer<typeof discoveredDrbdResourceSchema>;

export const formerInstallationSchema = z
  .object({
    /** The agent's state directory exists. */
    stateDir: z.boolean(),
    clusterId: z.string().max(64).optional(),
    nodeName: z.string().max(63).optional(),
    drbdResources: z.array(discoveredDrbdResourceSchema).max(4096),
    /** Loadweaver interfaces left behind (`lw0`, `lwbr0`, `lw-*`, `lwk*`). */
    interfaces: z.array(z.string().max(32)).max(4096),
    /** Loadweaver nftables tables (`inet loadweaver`, `inet lw_*`). */
    nftTables: z.array(z.string().max(64)).max(64),
    /** Containers carrying `loadweaver.com/managed`. */
    managedContainers: z.number().int().nonnegative(),
  })
  .strict();
export type FormerInstallation = z.infer<typeof formerInstallationSchema>;

export const discoveryReportSchema = z
  .object({
    version: z.literal(DISCOVERY_REPORT_VERSION),
    at: z.string().datetime(),
    hostname: z.string().max(64),
    docker: z.object({ available: z.boolean(), version: z.string().max(64).optional() }).strict(),
    composeProjects: z.array(discoveredComposeProjectSchema).max(256),
    containers: z.array(discoveredContainerSchema).max(1024),
    volumes: z.array(discoveredVolumeSchema).max(1024),
    networks: z.array(discoveredNetworkSchema).max(256),
    listeners: z.array(discoveredListenerSchema).max(4096),
    interfaces: z.array(discoveredInterfaceSchema).max(4096),
    routes: z.array(discoveredRouteSchema).max(16_384),
    vpns: z.array(discoveredVpnSchema).max(256),
    nftables: z.array(z.object({ family: z.string().max(16), name: z.string().max(64) }).strict()).max(1024),
    /** Markers of a former Loadweaver installation; null on a host that never ran Loadweaver. */
    former: formerInstallationSchema.nullable(),
    /** What discovery could not read (commands missing, permissions); never fatal. */
    warnings: z.array(z.string().max(1024)).max(256),
  })
  .strict();
export type DiscoveryReport = z.infer<typeof discoveryReportSchema>;

/** Control plane → agent: discover again (feature `node-import`). */
export const discoveryRequestSchema = z.object({ request: z.string().uuid() }).strict();
export type DiscoveryRequest = z.infer<typeof discoveryRequestSchema>;

/** Agent → control plane: the answer to `discoveryRequest`. */
export const discoveryResultSchema = z.object({ request: z.string().uuid(), report: discoveryReportSchema }).strict();
export type DiscoveryResult = z.infer<typeof discoveryResultSchema>;

/** One copy of a source directory into a replicated volume (mounted on this node, its primary). */
export const importCopySchema = z
  .object({
    source: absolutePath,
    /** Docker name of the Loadweaver volume (`lw-vol-…`), mounted by the agent for the copy. */
    volume: z.string().regex(/^lw-vol-[a-z0-9_.-]{1,200}$/),
  })
  .strict();
export type ImportCopy = z.infer<typeof importCopySchema>;

export const importActionSchema = z.discriminatedUnion('kind', [
  /** Installs what the node components need (idempotent: present packages / settings are left as they are). */
  z
    .object({
      kind: z.literal('components'),
      script: z
        .string()
        .min(1)
        .max(64 * 1024),
    })
    .strict(),
  /** rsync pre-copy while the source still runs (no deletes). */
  z.object({ kind: z.literal('precopy'), copies: z.array(importCopySchema).min(1).max(256) }).strict(),
  /** Stops the source containers (restart policy off, so a Docker restart doesn't bring them back). */
  z.object({ kind: z.literal('stop'), containers: z.array(containerId).min(1).max(1024) }).strict(),
  /** rsync final pass with deletes while the source is stopped; unmounts the volumes afterwards. */
  z.object({ kind: z.literal('final-sync'), copies: z.array(importCopySchema).min(1).max(256) }).strict(),
  /** Rollback: starts the source containers again with their previous restart policies. */
  z
    .object({
      kind: z.literal('restart-source'),
      containers: z.array(containerId).min(1).max(1024),
      restartPolicies: z.record(containerId, z.string().max(32)).optional(),
    })
    .strict(),
  /** Checks that the source no longer holds the ports the ingress takes over. */
  z
    .object({
      kind: z.literal('handover'),
      containers: z.array(containerId).max(1024),
      ports: z.array(z.object({ protocol: z.enum(['tcp', 'udp']), port: portNumber }).strict()).max(1024),
    })
    .strict(),
  /** Removes the identity and keys of a former, different cluster (archived by `join --discover`). */
  z.object({ kind: z.literal('wipe-identity'), clusterId: z.string().max(64) }).strict(),
]);
export type ImportAction = z.infer<typeof importActionSchema>;
export type ImportActionKind = ImportAction['kind'];

export const importStepCommandSchema = z
  .object({
    import: z.string().uuid(),
    step: z.string().regex(/^[a-z0-9][a-z0-9:._/-]{0,199}$/),
    action: importActionSchema,
  })
  .strict();
export type ImportStepCommand = z.infer<typeof importStepCommandSchema>;

export const importProgressSchema = z
  .object({
    import: z.string().uuid(),
    step: z.string().regex(/^[a-z0-9][a-z0-9:._/-]{0,199}$/),
    status: z.enum(['running', 'done', 'failed']),
    message: z.string().max(4096).optional(),
    /** Bytes copied so far (copies). */
    bytes: z.number().int().nonnegative().optional(),
    /** Restart policies of stopped containers (for `restart-source`). */
    restartPolicies: z.record(containerId, z.string().max(32)).optional(),
  })
  .strict();
export type ImportProgress = z.infer<typeof importProgressSchema>;
