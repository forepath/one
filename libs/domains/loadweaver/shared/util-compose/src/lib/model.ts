import type { Selector } from '@forepath/loadweaver/shared/util-model';

/** Normalized deployment produced from a compose project (3.11). */

export interface ResourceAmount {
  cpuMillis: number;
  memoryBytes: number;
}

export interface ServiceResources {
  /** Drive scheduling, capacity and the N+1 reserve. */
  requests: ResourceAmount;
  limits: Partial<ResourceAmount>;
  /** Services without compose resources run on the project defaults; the plan lists them. */
  source: 'compose' | 'project-default';
}

export interface HealthCheck {
  /** `null` = health check disabled. */
  test: string[] | null;
  intervalMs: number;
  timeoutMs: number;
  retries: number;
  startPeriodMs: number;
}

export type VolumeMount =
  | { type: 'volume'; source: string; target: string; readOnly: boolean }
  | { type: 'bind'; source: string; target: string; readOnly: boolean }
  | { type: 'tmpfs'; target: string; sizeBytes?: number };

export interface FileMount {
  /** Secret or config name within the project. */
  source: string;
  target: string;
  mode?: number;
}

export interface PortExposure {
  protocol: 'tcp' | 'udp';
  publishedPort: number;
  targetPort: number;
}

export interface Rate {
  requests: number;
  unit: 'second' | 'minute' | 'hour' | 'day';
}

export interface HttpExposure {
  host: string;
  /** Container port the ingress forwards to. */
  port: number;
  path: string;
  rateLimit?: { perIp?: Rate; perKey?: { header: string; rate: Rate }; total?: Rate };
  waf?: 'off' | 'monitor' | 'enforce';
}

/** Something that ties data, deployment or traffic to a single host (3.12). */
export interface Pin {
  kind: 'data' | 'deployment' | 'traffic';
  reason: string;
}

export interface CronSpec {
  schedule: string;
  timezone: string;
  concurrency: 'allow' | 'forbid' | 'replace';
  retries: number;
  timeoutSeconds: number;
}

export interface AutoscaleSpec {
  min: number;
  max: number;
  metric: 'cpu' | 'memory' | 'requests' | 'custom';
  target: number;
  customMetric?: string;
}

export interface ServiceSpec {
  name: string;
  image: string;
  command?: string[];
  entrypoint?: string[];
  environment: Record<string, string>;
  labels: Record<string, string>;
  user?: string;
  workingDir?: string;
  hostname?: string;
  replicas: number;
  resources: ServiceResources;
  healthcheck?: HealthCheck;
  dependsOn: { service: string; condition: 'started' | 'healthy' | 'completed' }[];
  volumes: VolumeMount[];
  secrets: FileMount[];
  configs: FileMount[];
  /** Compose networks the service is attached to (each one is a workload group, 3.11). */
  networks: string[];
  /** Additional workload groups from `x-loadweaver.groups`. */
  groups: string[];
  aliases: string[];
  ports: PortExposure[];
  http: HttpExposure[];
  runtime: 'runc' | 'sandboxed';
  placement?: Selector;
  spread: 'node' | 'site';
  kind: 'service' | 'job' | 'cron';
  /** One-off jobs run once per apply, before or after the other services. */
  jobPhase?: 'before' | 'after';
  cron?: CronSpec;
  autoscale?: AutoscaleSpec;
  liveMigration: boolean;
  restart: 'no' | 'always' | 'on-failure' | 'unless-stopped';
  capAdd: string[];
  capDrop: string[];
  readOnly: boolean;
  privileged: boolean;
  init: boolean;
  networkMode?: string;
  devices: string[];
  containerName?: string;
  stopGracePeriodMs: number;
  stopSignal?: string;
  extraHosts: string[];
  ulimits: Record<string, { soft: number; hard: number }>;
  pins: Pin[];
  /** `x-loadweaver.pinned.reason`: pins acknowledged in config (3.12). */
  pinAcknowledgement?: string;
}

export interface VolumeSpec {
  name: string;
  external: boolean;
  sizeBytes: number;
  /** Synchronous replicas within the primary's site (incl. the primary). */
  replicas: number;
  /** Cross-site replication mode (3.5): async by default. */
  crossSite: 'async' | 'sync' | 'none';
  pins: Pin[];
  pinAcknowledgement?: string;
}

export interface SecretSpec {
  name: string;
  /** `secret://project/name[@version]` reference, never the value (3.29). */
  ref: string;
}

export interface ComposeDeployment {
  name: string;
  services: ServiceSpec[];
  volumes: VolumeSpec[];
  networks: { name: string; external: boolean }[];
  secrets: SecretSpec[];
  configs: SecretSpec[];
}

export interface ComposeIssue {
  level: 'error' | 'warning';
  path: string;
  message: string;
}

export type ComposeParseResult =
  | { ok: true; deployment: ComposeDeployment; warnings: ComposeIssue[] }
  | { ok: false; issues: ComposeIssue[] };
