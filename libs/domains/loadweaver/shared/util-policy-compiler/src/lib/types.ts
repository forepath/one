import type {
  ClusterNetwork,
  HttpMatch,
  Labels,
  NodeGroupSpec,
  PolicySpec,
  WorkloadGroupSpec,
} from '@forepath/loadweaver/shared/util-model';

/** A node as the compiler sees it: identity, placement and allocated addresses. */
export interface CompilerNode {
  name: string;
  site: string;
  labels: Labels;
  controlPlane: boolean;
  witness: boolean;
  /** Router / overlay address of the node (BGP source, WireGuard address). */
  overlayV4?: string;
  overlayV6?: string;
  /** Per-node container subnets announced via BIRD (3.4). */
  podSubnetV4?: string;
  podSubnetV6?: string;
  /** Public WireGuard endpoint host; absent when the node is behind NAT (3.21). */
  endpointHost?: string;
  wireguardPublicKey: string;
  /** Holds object-store (Garage) data: control-plane members, and former ones until their data moved (3.20). */
  objectStore?: boolean;
  /** Runs the ingress: may hold ingress addresses (3.6). */
  ingress?: boolean;
  /** UDP ports the host uses itself (found by the import discovery, 3.21): WireGuard listen ports skip them. */
  reservedUdpPorts?: readonly number[];
}

/** One running replica of a service. */
export interface CompilerWorkload {
  /** Stable id, e.g. `shop/api/0`. */
  id: string;
  project: string;
  deployment: string;
  service: string;
  node: string;
  /** Service labels plus the automatic `loadweaver.com/*` labels. */
  labels: Labels;
  addresses: string[];
  /** Groups joined explicitly: compose networks (`compose:<deployment>/<network>`) and `x-loadweaver.groups`. */
  groups?: string[];
  /**
   * Addresses the replica kept from another node's pod subnet (live migration, 3.10): the node originates them as
   * host routes (`/32`, `/128`), more specific than the subnet of the node they came from.
   */
  keptAddresses?: string[];
  /**
   * Removed and draining (M6 gate): keeps its policies, so open connections continue, but is no backend of its
   * service IPs and no mesh endpoint any more; it stops once the drain ends.
   */
  draining?: boolean;
  /**
   * An additional NIC of a full VM (3.35, M7: one or more NICs, each with its own groups / policies): a policy
   * member with its own addresses, labels and groups, but never a backend of the VM's service IPs or mesh identity
   * (those answer on the primary NIC only).
   */
  secondaryInterface?: boolean;
}

/** A service with its stable service IPs (3.4), resolved through the policy-aware DNS. */
export interface CompilerService {
  project: string;
  deployment: string;
  name: string;
  serviceIps: string[];
}

export interface NamedNodeGroup {
  name: string;
  spec: NodeGroupSpec;
}

export interface NamedWorkloadGroup {
  project: string;
  name: string;
  spec: WorkloadGroupSpec;
}

export interface NamedPolicy {
  /** Owning project; undefined for cluster-wide policies. */
  project?: string;
  name: string;
  spec: PolicySpec;
  /** Built-in platform policies are generated, not user-authored (3.3). */
  builtin?: boolean;
}

/** Previously allocated WireGuard listen ports, so links keep their ports across compilations. */
export type PortAllocations = Record<string, Record<string, number>>;

export interface CompilerInput {
  network: ClusterNetwork;
  nodes: CompilerNode[];
  workloads: CompilerWorkload[];
  services: CompilerService[];
  nodeGroups: NamedNodeGroup[];
  workloadGroups: NamedWorkloadGroup[];
  policies: NamedPolicy[];
  portAllocations?: PortAllocations;
  /** Current route reflectors, kept stable while they stay eligible (3.34). */
  routeReflectors?: string[];
  /** Ports of the platform services used by the built-in policies. */
  platformPorts?: Partial<PlatformPorts>;
  /** A project has a public status page: the ingress reaches the members' HTTP API (3.25). */
  statusPages?: boolean;
  /** Egress addresses from own prefixes (3.27): which policy's traffic leaves with which address, from which node. */
  egress?: CompilerEgress[];
  /** Cluster-wide egress filtering through the node proxies (3.7). */
  egressFilter?: {
    mode: 'off' | 'monitor' | 'enforce' | 'offline';
    blockPrivateNetworks: boolean;
    blockIpLiterals: boolean;
    logAllowed: boolean;
  };
  /** Remote access (3.31): the gateways and the enrolled clients with their effective groups. */
  remoteAccess?: CompilerRemoteAccess;
}

/** An enrolled, valid remote client (user device or machine). */
export interface CompilerClient {
  id: string;
  /** `alice@example.com/laptop` or `machine/office-berlin`, for rules, logs and the map. */
  label: string;
  publicKey: string;
  /** Client address (IPv4, from the client network). */
  address: string;
  /** Networks behind a machine client (office subnets, site-to-site). */
  subnets: string[];
  /** Client groups after posture (failing groups replaced by their restricted group). */
  groups: string[];
  fullTunnel: boolean;
}

export interface CompilerRemoteAccess {
  /** Nodes of the `vpn` node group: all get the client peers. */
  gateways: string[];
  /** Holder of the gateway address: clients are located here. Undefined while nobody holds it. */
  active?: string;
  clientNetwork: string;
  port: number;
  /** Names of the defined client groups. */
  groups: string[];
  clients: CompilerClient[];
}

export interface CompilerEgress {
  /** Policy key (`project/name`, or the name of a cluster-wide policy). */
  policy: string;
  /** The egress address, held by `holder`. */
  address: string;
  holder: string;
}

export interface PlatformPorts {
  /** Control-plane API (node agent gRPC stream terminates here, 3.19). */
  api: number;
  etcdClient: number;
  etcdPeer: number;
  postgres: number;
  patroni: number;
  bgp: number;
  wireguardBase: number;
  /** Garage S3, RPC and admin ports of both object-store generations (3.20). */
  objectStore: number[];
  /** Built-in registry: private instance and pull-through mirrors (3.22). */
  registry: { from: number; to: number };
  /** Cluster-wide rate-limit service on the members (3.6). */
  rateLimit: number;
  /** OpenSearch HTTP and transport on the members (logs, 3.14). */
  logStore: number[];
  /** The control-plane HTTP API on the members (status pages through the ingress, 3.25). */
  http: number;
  /** Backup repository servers (Kopia) on the members, one port per repository (3.20). */
  backups: { from: number; to: number };
}

export const DEFAULT_PLATFORM_PORTS: PlatformPorts = {
  api: 7443,
  etcdClient: 2379,
  etcdPeer: 2380,
  postgres: 5432,
  patroni: 8008,
  bgp: 179,
  wireguardBase: 51820,
  objectStore: [3900, 3901, 3903, 3910, 3911, 3913],
  registry: { from: 5000, to: 5016 },
  rateLimit: 8081,
  logStore: [9200, 9300],
  http: 3400,
  backups: { from: 7500, to: 7755 },
};

/** Remote clients (3.31) are located at the active gateway and routed like its workloads. */
export type EndpointKind = 'node' | 'workload' | 'client' | 'external';

export type FlowProtocol = 'tcp' | 'udp' | 'icmp' | 'any';

/** An allowed L3/L4 flow between two concrete endpoint sets, derived from exactly one policy. */
export interface Flow {
  policy: string;
  mode: 'enforce' | 'monitor';
  srcNode?: string;
  dstNode?: string;
  srcKind: EndpointKind;
  dstKind: EndpointKind;
  /** Per-site hub that forwards built-in traffic in large clusters (3.34). */
  via?: string;
  /** Addresses (single IPs or CIDRs) on each side. */
  src: string[];
  dst: string[];
  protocol: FlowProtocol;
  /** `"80"` or `"8000-8100"`; empty = all ports. */
  ports: string[];
  /** From a rule with HTTP matches: only valid where the node proxies carry it (3.7). */
  l7?: boolean;
}

export interface WireguardLink {
  /** Interface name on this node, e.g. `lw-n3`. */
  interface: string;
  listenPort: number;
  peer: string;
  peerPublicKey: string;
  /** `host:port` of the peer, absent if the peer is behind NAT (then only the peer dials in). */
  peerEndpoint?: string;
  /** Exactly the addresses this node may exchange with the peer, never more (3.3). */
  allowedIps: string[];
  persistentKeepalive?: number;
  /** Addresses of this node on the link (its overlay addresses). */
  addresses: string[];
  /** Overlay addresses of the peer, reachable directly over this link. */
  peerAddresses: string[];
  /** Policies that require this link, for the plan ("adds WireGuard peer n1↔n3"). */
  reasons: string[];
}

export type BgpRole = 'peer' | 'route-reflector' | 'route-reflector-client';

export interface BgpSession {
  peer: string;
  interface: string;
  peerAddress: string;
  /** All overlay addresses of the peer; one BGP session per address family is rendered. */
  peerAddresses: string[];
  /** Role of the remote side relative to this node. */
  role: BgpRole;
  /** Prefixes this node exports to the peer. */
  exports: string[];
  /** Prefixes accepted from the peer (import filter). */
  imports: string[];
}

export interface BgpConfig {
  asn: number;
  routerId: string;
  routeReflector: boolean;
  /** Prefixes originated by this node (pod subnets, service IPs of local replicas). */
  originate: string[];
  sessions: BgpSession[];
}

export interface FirewallRule {
  id: string;
  policy: string;
  /** `input`: to the host itself, `forward`: to local containers, `output`: from the host. */
  chain: 'input' | 'forward' | 'output';
  srcSet: string;
  dstSet: string;
  protocol: FlowProtocol;
  ports: string[];
  /** `observe` = accept and log as observed (`monitor` mode). */
  action: 'accept' | 'observe';
}

export interface FirewallConfig {
  /** Named address sets (nftables sets), keyed by set name. */
  sets: Record<string, string[]>;
  rules: FirewallRule[];
}

export interface DnsRecord {
  name: string;
  addresses: string[];
}

export interface DnsConfig {
  /** Cluster DNS domain, e.g. `lw` for `<service>.<project>.lw`. */
  domain: string;
  records: DnsRecord[];
  /** Per local client address: the names it may resolve (policy-aware DNS, 3.4). */
  visibility: Record<string, string[]>;
}

/** Stable service IP DNAT'ed on the client's node to replicas it may reach (3.4). */
export interface ServiceNat {
  name: string;
  serviceIp: string;
  backends: string[];
}

export interface NodeNetworkConfig {
  node: string;
  /** The node's own overlay addresses (router id, BGP source, address on every link). */
  addresses: string[];
  wireguard: WireguardLink[];
  services: ServiceNat[];
  bgp: BgpConfig;
  firewall: FirewallConfig;
  dns: DnsConfig;
  /** Egress from own prefixes: routes to gateways, and source NAT on the gateway (3.27). */
  egress?: EgressConfig;
  /** East-west through the node proxy with mTLS and L7 rules (3.7). */
  mesh?: MeshConfig;
  /** Web egress of local workloads through the node proxy (3.7). */
  egressFilter?: EgressFilterConfig;
  /** Remote access gateway (3.31). */
  remoteAccess?: RemoteAccessConfig;
}

/** A remote access gateway's WireGuard interface (`lw-vpn`) and its clients (3.31). */
export interface RemoteAccessConfig {
  /** Holds the gateway address: clients' traffic is routed and filtered here. Standby gateways only keep the peers. */
  active: boolean;
  listenPort: number;
  /** The gateway's address in the client network, with its prefix length (also the clients' DNS server). */
  address: string;
  peers: { id: string; label: string; publicKey: string; allowedIps: string[] }[];
  /** Client prefixes (client network, office subnets): routed into the tunnel, NAT'ed when leaving the cluster. */
  prefixes: string[];
}

/** What a client's own WireGuard configuration needs (3.31): split-tunnel routes and its DNS view. */
export interface ClientConfig {
  address: string;
  dns: string;
  /** AllowedIPs of the gateway peer on the client: exactly what its policies allow (or everything for full tunnel). */
  routes: string[];
  /** Service names it may resolve. */
  names: string[];
}

/** Web ports egress filtering inspects. */
export type EgressWebPort = 80 | 443;

export interface EgressHostRule {
  /** `example.com` (itself and its subdomains) or `*.example.com`. */
  host: string;
  ports: EgressWebPort[];
  policy: string;
  /** Only recorded, never blocking. */
  monitor: boolean;
}

/** A web deny by destination address (deny policies naming CIDRs on ports 80 / 443). */
export interface EgressCidrRule {
  cidr: string;
  ports: EgressWebPort[];
  policy: string;
  monitor: boolean;
}

/** Egress filtering of a node's workloads (3.7, Agenstra's semantics). */
export interface EgressFilterConfig {
  /**
   * The cluster's mode; with the cluster `off`, the strictest mode of the node's sources (an agent without per-source
   * settings then filters too much, never too little).
   */
  mode: 'monitor' | 'enforce' | 'offline';
  blockPrivateNetworks: boolean;
  blockIpLiterals: boolean;
  logAllowed: boolean;
  /** Cluster address ranges: never sent through the egress listeners. */
  clusterRanges: string[];
  sources: {
    address: string;
    /** Web ports the source may use and to which destinations (the redirect covers exactly these). */
    ports: { port: EgressWebPort; destinations: string[] }[];
    allow: EgressHostRule[];
    deny: EgressHostRule[];
    /** Destinations allowed by CIDR policies, part of the allow list. */
    allowCidrs: string[];
    /** Internet-wide access without any allow list. */
    unrestricted: boolean;
    /**
     * Settings of policies selecting this source (`Policy.egressMode` ...), combined with the cluster's, the most
     * restrictive wins; absent: the node-level values apply.
     */
    mode?: 'monitor' | 'enforce' | 'offline';
    blockPrivateNetworks?: boolean;
    blockIpLiterals?: boolean;
    logAllowed?: boolean;
    /** URL deny patterns (plain HTTP), translated to RE2 (full match against `http://host/path?query`). */
    denyUrlRegexes?: string[];
    /** Web denies by destination address. */
    denyCidrs?: EgressCidrRule[];
  }[];
}

/** The node proxy's east-west configuration (3.7). Identities are `project/deployment/service`. */
export interface MeshConfig {
  /** Identities of local replicas the proxy speaks for (as client and as server). */
  identities: string[];
  /** Local workloads' service traffic the proxy takes over: source, service IP and port. */
  outbound: { source: string; identity: string; serviceIp: string; port: number; upstream: string }[];
  /** Destination services: their SNI and identity, and the proxies of the nodes running replicas. */
  upstreams: { name: string; sni: string; identity: string; endpoints: string[] }[];
  /** Local service ports the proxy answers for, with who may connect and what (deny wins). */
  inbound: {
    sni: string;
    identity: string;
    port: number;
    backends: string[];
    /** HTTP-aware (L7 rules) or plain TCP. */
    http: boolean;
    rules: {
      identity: string;
      policy: string;
      mode: 'enforce' | 'monitor';
      action: 'allow' | 'deny';
      http?: HttpMatch;
    }[];
  }[];
}

export interface EgressConfig {
  /** Local sources whose traffic to these destinations outside the cluster goes to a gateway over its link. */
  routes: { interface: string; sources: string[]; destinations: string[] }[];
  /** On the gateway: sources (local or arriving over links) leaving with an address. */
  snat: { address: string; sources: string[] }[];
}

export interface CompilerDiagnostic {
  level: 'warning' | 'error';
  policy?: string;
  message: string;
}

export interface CompilationResult {
  nodes: Record<string, NodeNetworkConfig>;
  flows: Flow[];
  portAllocations: PortAllocations;
  routeReflectors: string[];
  diagnostics: CompilerDiagnostic[];
  /** Per remote client id (3.31). */
  clients: Record<string, ClientConfig>;
}
