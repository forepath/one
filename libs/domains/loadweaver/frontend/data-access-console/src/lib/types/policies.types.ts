import type { ConsoleResource } from './resources.types';

/** Groups & policies (3.3): `WorkloadGroup` and `Policy` resources plus group members from `GET /topology`. */

export interface LabelSelectorExpression {
  key: string;
  operator: 'In' | 'NotIn' | 'Exists' | 'DoesNotExist';
  values?: string[];
}

/** All given conditions must hold; `names` is the static-membership shortcut; empty matches everything. */
export interface LabelSelector {
  names?: string[];
  matchLabels?: Record<string, string>;
  matchExpressions?: LabelSelectorExpression[];
}

export interface WorkloadGroupSpec {
  description?: string;
  selector: LabelSelector;
  /** `isolate`: members may not talk to each other without a policy. */
  intraGroup?: 'allow' | 'isolate';
  /** Discoverable by other projects, which may request access (3.17). */
  exposed?: boolean;
}

/** One endpoint of a policy: exactly one form per entry. */
export interface PolicyPeer {
  group?: string;
  project?: string;
  builtin?: string;
  site?: string;
  selector?: LabelSelector;
  cidr?: string;
  host?: string;
  clients?: string;
}

export interface PolicyRule {
  protocol?: 'tcp' | 'udp' | 'icmp' | 'any';
  ports?: (number | string)[];
  http?: { hosts?: string[]; paths?: string[]; methods?: string[] };
}

export interface PolicySpec {
  description?: string;
  mode?: 'enforce' | 'monitor';
  action?: 'allow' | 'deny';
  from: PolicyPeer[];
  to: PolicyPeer[];
  rules: PolicyRule[];
  egress?: { pools: string[]; reverseDns?: string };
}

export type WorkloadGroupResource = ConsoleResource<WorkloadGroupSpec>;
export type PolicyResource = ConsoleResource<PolicySpec>;

/** A replica in a workload group (from the map's `member` edges). */
export interface GroupMember {
  /** Replica id (`<project>/<deployment>/<service>/<index>`). */
  replica: string;
  label: string;
  deployment: string | null;
  service: string | null;
  state: string | null;
  health: string | null;
}

/** Members per group, keyed `<project>/<group>`. */
export type GroupMembers = Record<string, GroupMember[]>;
