import {
  clusterSpecSchema,
  policySpecSchema,
  workloadGroupSpecSchema,
  type PolicyPeer,
} from '@forepath/loadweaver/shared/util-model';
import {
  egressSourceSettings,
  peerWorkloads,
  type CompilerInput,
  type CompilerWorkload,
  type NamedPolicy,
  type NamedWorkloadGroup,
} from '@forepath/loadweaver/shared/util-policy-compiler';
import type { SchedulerService } from '@forepath/loadweaver/shared/util-scheduler';

import type { ResourceEntity } from '../entities/resource.entity';
import { composeNetworkGroup, serviceId, workloadLabels, type ParsedDeployment } from './workload-planning.utils';

/** The protocol feature of agents that apply per-source egress settings themselves (M5). */
export const EGRESS_POLICIES_FEATURE = 'egress-policies';

/** Per-source settings that agents without `egress-policies` can't apply, not even folded (`egress-downgrade.ts`). */
export type UnfoldableEgressSetting = 'denyUrlPatterns' | 'denyCidrs';

const WEB_PORTS = [80, 443];
const INTERNET = new Set(['0.0.0.0/0', '::/0']);

function coversWeb(rules: NamedPolicy['spec']['rules']): boolean {
  return rules.some(
    (rule) =>
      (rule.protocol === 'tcp' || rule.protocol === 'any') &&
      (!rule.ports?.length ||
        rule.ports.some((p) => {
          const [from, to = from] = String(p).split('-').map(Number);

          return WEB_PORTS.some((port) => port >= from && port <= to);
        })),
  );
}

/**
 * Services (`project/deployment/service`) whose per-source egress settings an agent without `egress-policies` can't
 * apply even folded into its node-level settings (M6 gate; the fold is `foldEgressPoliciesForLegacy`):
 *
 * - `denyUrlPatterns`: URL deny patterns of a filtered source (an `offline` source needs none: nothing passes);
 * - `denyCidrs`: enforced address denies of a source without an allow list (an `internet` policy on 80 / 443 and no
 *   hostname allows), which have no allow-list CIDRs to take away.
 *
 * Evaluated per service on the policies and groups (selectors, groups, compose networks), the same way the compiler
 * resolves them for replicas; replicas are placed by service, so all of a service's replicas share the result.
 */
export function unfoldableEgressServices(
  parsed: readonly ParsedDeployment[],
  resources: readonly ResourceEntity[],
): Map<string, UnfoldableEgressSetting[]> {
  const clusterResource = resources.find((r) => r.kind === 'Cluster');
  const cluster = clusterResource ? clusterSpecSchema.parse(clusterResource.spec).egress : undefined;
  const policies: NamedPolicy[] = resources
    .filter((r) => r.kind === 'Policy')
    .map((r) => ({ project: r.project ?? undefined, name: r.name, spec: policySpecSchema.parse(r.spec) }));
  const result = new Map<string, UnfoldableEgressSetting[]>();

  if (policies.length === 0) return result;

  const workloads: CompilerWorkload[] = parsed.flatMap((d) =>
    d.compose.services.map((s) => {
      const id = serviceId(d.project, d.name, s.name);

      return {
        id,
        project: d.project,
        deployment: d.name,
        service: s.name,
        node: '',
        labels: workloadLabels(d.project, d.name, s, 0),
        // The service id stands in for the replicas' addresses.
        addresses: [id],
        groups: [...s.networks.map((n) => composeNetworkGroup(d.name, n)), ...s.groups],
      };
    }),
  );
  const workloadGroups: NamedWorkloadGroup[] = [
    ...resources
      .filter((r) => r.kind === 'WorkloadGroup' && r.project)
      .map((r) => ({ project: r.project as string, name: r.name, spec: workloadGroupSpecSchema.parse(r.spec) })),
    ...parsed.flatMap((d) =>
      d.compose.networks.map((n) => ({
        project: d.project,
        name: composeNetworkGroup(d.name, n.name),
        spec: { selector: { names: [] }, intraGroup: 'allow' as const, exposed: false },
      })),
    ),
  ];
  // Only what `egressSourceSettings` and `peerWorkloads` read.
  const input = { egressFilter: cluster, policies, workloads, workloadGroups } as unknown as CompilerInput;
  const settings = egressSourceSettings(input);
  const selected = (policy: NamedPolicy, workload: CompilerWorkload) =>
    policy.spec.from.some((peer: PolicyPeer) => peerWorkloads(input, policy, peer).some((w) => w.id === workload.id));
  const enforced = policies.filter((p) => p.spec.mode !== 'monitor' && coversWeb(p.spec.rules));
  const cidrDenies = enforced.filter(
    (p) => p.spec.action === 'deny' && p.spec.to.length > 0 && p.spec.to.every((peer) => 'cidr' in peer),
  );
  const internetAllows = enforced.filter(
    (p) =>
      p.spec.action === 'allow' &&
      p.spec.to.some(
        (peer) => ('builtin' in peer && peer.builtin === 'internet') || ('cidr' in peer && INTERNET.has(peer.cidr)),
      ),
  );
  const hostAllows = enforced.filter((p) => p.spec.action === 'allow' && p.spec.to.some((peer) => 'host' in peer));

  for (const workload of workloads) {
    const own = settings.get(workload.id);
    const mode = own?.mode ?? cluster?.mode ?? 'off';

    // Not filtered, or nothing passes anyway: the fold is exact.
    if (mode === 'off' || mode === 'offline') continue;

    const unfoldable: UnfoldableEgressSetting[] = [];

    if ((own?.denyUrlRegexes.length ?? 0) > 0) unfoldable.push('denyUrlPatterns');

    if (
      cidrDenies.some((p) => selected(p, workload)) &&
      internetAllows.some((p) => selected(p, workload)) &&
      !hostAllows.some((p) => selected(p, workload))
    )
      unfoldable.push('denyCidrs');

    if (unfoldable.length > 0) result.set(workload.id, unfoldable);
  }

  return result;
}

/** Scheduler services with `requiredFeatures` for the services `unfoldableEgressServices` names (M6 gate). */
export function withEgressFeatureRequirements(
  services: readonly SchedulerService[],
  unfoldable: ReadonlyMap<string, readonly UnfoldableEgressSetting[]>,
): SchedulerService[] {
  return services.map((s) => {
    const settings = unfoldable.get(s.id);

    return settings?.length
      ? {
          ...s,
          requiredFeatures: [...new Set([...(s.requiredFeatures ?? []), EGRESS_POLICIES_FEATURE])],
          requiredFeaturesReason: `per-source egress settings older agents can't apply: ${settings.join(', ')}`,
        }
      : s;
  });
}

/**
 * Plan warnings for replicas that stay on nodes without `egress-policies` while their service needs it (the
 * scheduler doesn't move them): the agent there can't apply the settings until it is updated.
 */
export function legacyEgressPlacementIssues(
  replicas: readonly { service: string; replica: string; node: string }[],
  unfoldable: ReadonlyMap<string, readonly UnfoldableEgressSetting[]>,
  features: ReadonlyMap<string, readonly string[]>,
): { level: 'warning'; project: string; deployment: string; path: string; message: string }[] {
  return replicas
    .filter((r) => unfoldable.has(r.service) && !(features.get(r.node) ?? []).includes(EGRESS_POLICIES_FEATURE))
    .map((r) => {
      const [project, deployment, service] = r.service.split('/');

      return {
        level: 'warning' as const,
        project,
        deployment,
        path: `services.${service}`,
        message: `replica ${r.replica} stays on node ${r.node}, whose agent lacks the ${EGRESS_POLICIES_FEATURE} protocol feature and can't apply its ${unfoldable.get(r.service)?.join(', ')}; update the agent on ${r.node} (new replicas only go to updated nodes)`,
      };
    });
}
