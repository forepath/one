import type {
  LabelSelector,
  PolicyPeer,
  PolicyResource,
  PolicyRule,
  WorkloadGroupResource,
} from '@forepath/loadweaver/frontend/data-access-console';

/** `app=web, tier In (a, b)`; an empty selector matches everything. */
export function selectorLabel(selector: LabelSelector | null | undefined): string {
  const parts = [
    ...(selector?.names?.length ? [`name In (${selector.names.join(', ')})`] : []),
    ...Object.entries(selector?.matchLabels ?? {}).map(([key, value]) => `${key}=${value}`),
    ...(selector?.matchExpressions ?? []).map((e) =>
      e.values?.length ? `${e.key} ${e.operator} (${e.values.join(', ')})` : `${e.key} ${e.operator}`,
    ),
  ];

  return parts.length > 0 ? parts.join(', ') : $localize`:@@lwConsolePolicies-everything:everything`;
}

/** One policy endpoint as text: `group shop/web`, `internet`, `site fra1`, `10.0.0.0/8`, … */
export function peerLabel(peer: PolicyPeer): string {
  if (peer.group)
    return `${$localize`:@@lwConsolePolicies-peerGroup:group`} ${peer.project ? `${peer.project}/` : ''}${peer.group}`;

  if (peer.builtin) return peer.builtin;

  if (peer.site) return `${$localize`:@@lwConsolePolicies-peerSite:site`} ${peer.site}`;

  if (peer.selector) return `${$localize`:@@lwConsolePolicies-peerSelector:selector`} ${selectorLabel(peer.selector)}`;

  if (peer.cidr) return peer.cidr;

  if (peer.host) return `${$localize`:@@lwConsolePolicies-peerHost:host`} ${peer.host}`;

  if (peer.clients) return `${$localize`:@@lwConsolePolicies-peerClients:clients`} ${peer.clients}`;

  return '?';
}

export function peerIcon(peer: PolicyPeer): string {
  if (peer.group || peer.selector) return 'bi-collection';

  if (peer.builtin) return peer.builtin === 'internet' ? 'bi-globe' : 'bi-diagram-3';

  if (peer.site) return 'bi-geo-alt';

  if (peer.cidr) return 'bi-ethernet';

  if (peer.host) return 'bi-link-45deg';

  if (peer.clients) return 'bi-laptop';

  return 'bi-question';
}

/** A rule protocol, readable (3.38 D9). */
export function protocolLabel(protocol: string): string {
  switch (protocol) {
    case 'tcp':
      return 'TCP';
    case 'udp':
      return 'UDP';
    case 'icmp':
      return 'ICMP';
    case 'any':
      return $localize`:@@lwConsolePolicies-protocolAny:Any protocol`;
    default:
      return protocol;
  }
}

/** `tcp 443, 8000-8100 (GET /api on shop.example.com)`. */
export function ruleLabel(rule: PolicyRule): string {
  const protocol = rule.protocol ?? 'tcp';
  const ports = rule.ports?.length ? ` ${rule.ports.join(', ')}` : '';
  const http = rule.http
    ? [
        rule.http.methods?.join(', '),
        rule.http.paths?.join(', '),
        rule.http.hosts?.length
          ? `${$localize`:@@lwConsolePolicies-ruleOn:on`} ${rule.http.hosts.join(', ')}`
          : undefined,
      ]
        .filter(Boolean)
        .join(' ')
    : '';

  return `${protocol}${ports}${http ? ` (${http})` : ''}`;
}

/** `from → to` in one line. */
export function policySummary(policy: PolicyResource): string {
  return `${policy.spec.from.map(peerLabel).join(', ')} → ${policy.spec.to.map(peerLabel).join(', ')}`;
}

/** Key of a group in the members map: `<project>/<name>`. */
export function groupKey(group: WorkloadGroupResource): string {
  return `${group.metadata.project ?? ''}/${group.metadata.name}`;
}

/** The members key a group peer points to (its own project, or the policy's). */
export function peerGroupKey(peer: PolicyPeer, policyProject: string | null | undefined): string | null {
  const project = peer.project ?? policyProject;

  return peer.group && project ? `${project}/${peer.group}` : null;
}
