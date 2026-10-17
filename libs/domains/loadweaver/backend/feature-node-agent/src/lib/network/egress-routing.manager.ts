import type { NodeNetworkConfig } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable } from '@nestjs/common';

import { CommandRunner } from '../host/command-runner';

/** Rules for egress sources: main table without its default route first, then the gateway's table (3.27). */
export const EGRESS_RULE_MAIN = 7480;
export const EGRESS_RULE_GATEWAY = 7481;
/** One routing table per gateway link. */
export const EGRESS_TABLE_BASE = 7480;
const EGRESS_TABLE_MAX = EGRESS_TABLE_BASE + 63;

interface IpRule {
  priority: number;
  src?: string;
  srclen?: number;
  table?: string;
  suppress_prefixlength?: number;
}

export interface EgressRule {
  family: 4 | 6;
  priority: number;
  source: string;
  table: string;
}

const prefix = (address: string) => `${address}/${address.includes(':') ? 128 : 32}`;

export interface EgressRoute {
  family: 4 | 6;
  table: number;
  interface: string;
  /** `default` or a prefix. */
  destination: string;
}

/**
 * The rules and routes egress through gateways needs: traffic from a source to its egress destinations goes to the
 * gateway's link (a table holding just those destinations); everything the main table routes more specifically
 * (other nodes, pods, service IPs) is unaffected (`suppress_prefixlength 0`), and other destinations fall through to
 * the main table's default route.
 */
export function egressRouting(egress: NodeNetworkConfig['egress']): { rules: EgressRule[]; routes: EgressRoute[] } {
  const rules: EgressRule[] = [];
  const routes: EgressRoute[] = [];

  (egress?.routes ?? []).forEach((route, i) => {
    const table = EGRESS_TABLE_BASE + i;

    for (const family of [4, 6] as const) {
      const ofFamily = (a: string) => a.includes(':') === (family === 6);
      const sources = route.sources.filter(ofFamily);
      const destinations = route.destinations.filter(ofFamily);

      if (sources.length === 0 || destinations.length === 0) continue;

      for (const destination of destinations)
        routes.push({
          family,
          table,
          interface: route.interface,
          destination: destination === '0.0.0.0/0' || destination === '::/0' ? 'default' : destination,
        });

      for (const source of sources) {
        rules.push(
          { family, priority: EGRESS_RULE_MAIN, source: prefix(source), table: 'main' },
          { family, priority: EGRESS_RULE_GATEWAY, source: prefix(source), table: String(table) },
        );
      }
    }
  });

  return { rules, routes };
}

const ruleKey = (r: EgressRule) => `${r.family}|${r.priority}|${r.source}|${r.table}`;

@Injectable()
export class EgressRoutingManager {
  constructor(private readonly commands: CommandRunner) {}

  private async currentRules(): Promise<EgressRule[]> {
    const rules: EgressRule[] = [];

    for (const family of [4, 6] as const) {
      const listed = await this.commands
        .json<IpRule[]>('ip', [`-${family}`, '-j', 'rule', 'show'])
        .catch(() => [] as IpRule[]);

      for (const r of listed) {
        if ((r.priority !== EGRESS_RULE_MAIN && r.priority !== EGRESS_RULE_GATEWAY) || !r.src) continue;

        rules.push({
          family,
          priority: r.priority,
          source: `${r.src}/${r.srclen ?? (family === 6 ? 128 : 32)}`,
          table: r.table ?? 'main',
        });
      }
    }

    return rules;
  }

  async apply(egress: NodeNetworkConfig['egress']): Promise<boolean> {
    const desired = egressRouting(egress);
    const current = await this.currentRules();
    const wanted = new Set(desired.rules.map(ruleKey));
    const present = new Set(current.map(ruleKey));
    let changed = false;

    // Gateway routes first, so a new rule never points at an empty table; then routes no longer wanted go.
    for (const route of desired.routes) {
      await this.commands.run('ip', [
        `-${route.family}`,
        'route',
        'replace',
        route.destination,
        'dev',
        route.interface,
        'table',
        String(route.table),
      ]);
    }

    for (const family of [4, 6] as const) {
      const wanted = new Set(
        desired.routes.filter((r) => r.family === family).map((r) => `${r.table}|${r.destination}|${r.interface}`),
      );
      const listed = await this.commands
        .json<
          { dst: string; dev?: string; table?: string | number }[]
        >('ip', [`-${family}`, '-j', 'route', 'show', 'table', 'all'])
        .catch(() => [] as { dst: string; dev?: string; table?: string | number }[]);

      for (const r of listed) {
        const table = Number(r.table);

        if (!(table >= EGRESS_TABLE_BASE && table <= EGRESS_TABLE_MAX)) continue;

        if (wanted.has(`${table}|${r.dst}|${r.dev ?? ''}`)) continue;

        await this.commands.run('ip', [`-${family}`, 'route', 'del', r.dst, 'table', String(table)]);
        changed = true;
      }
    }

    for (const rule of desired.rules.filter((r) => !present.has(ruleKey(r)))) {
      await this.commands.run('ip', [
        `-${rule.family}`,
        'rule',
        'add',
        'from',
        rule.source,
        ...(rule.table === 'main' ? ['lookup', 'main', 'suppress_prefixlength', '0'] : ['lookup', rule.table]),
        'priority',
        String(rule.priority),
      ]);
      changed = true;
    }

    for (const rule of current.filter((r) => !wanted.has(ruleKey(r)))) {
      await this.commands.run('ip', [
        `-${rule.family}`,
        'rule',
        'del',
        'from',
        rule.source,
        'lookup',
        rule.table,
        'priority',
        String(rule.priority),
      ]);
      changed = true;
    }

    return changed;
  }
}
