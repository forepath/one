import type { RequestWithUser } from '@forepath/identity/backend';
import { policySpecSchema } from '@forepath/loadweaver/shared/util-model';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { canReadProject, planVisibleTo, type AccessCaller } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import { PlanEntity } from '../entities/plan.entity';
import { PublicAddressEntity } from '../entities/public-address.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { collectExposures, statusPageHosts } from '../ingress/ingress-state.utils';
import { NetworkStateService } from '../services/network-state.service';
import {
  buildTopology,
  flowEdges,
  planOverlay,
  scopeTopology,
  type TopologyEdge,
  type TopologyElement,
  type TopologyGraph,
} from './topology.utils';
import { autoscaleMapData } from '../autoscaling/autoscale.utils';

const FLOW_WINDOW_MS = 60_000;
/** The structure is shared by requests and the live view for this long. */
const STRUCTURE_TTL_MS = 10_000;

export interface TopologyQuery {
  /** Timeline: the flows around this time (default: now, the last minute). */
  at?: string;
  /** Plan overlay. */
  plan?: string;
  /** With live / historical flows (cluster roles: flows aren't attributed to projects). */
  flows?: boolean;
}

export type TopologyResponse = TopologyGraph & { at: string; overlay?: Record<string, 'create' | 'update' | 'delete'> };

interface Structure {
  graph: TopologyGraph;
  /** Per node: its firewall sets (flows name them as the node saw them). */
  sets: Map<string, Map<string, string[]>>;
  /** Replica and node addresses → element. */
  elementOfAddress: Map<string, string>;
  input: Awaited<ReturnType<NetworkStateService['loadInput']>>['input'];
}

/**
 * The topology map (3.9): sites ⊃ nodes ⊃ replicas, groups and their policy edges, tunnels, volume copies, hostnames
 * and public addresses with their holders, and traffic (flows of the last minute, or around a past time for the
 * timeline), optionally with a pending plan's overlay. Scoped by access; traffic for cluster roles (flows carry
 * addresses, not projects).
 */
@Injectable()
export class TopologyService {
  private cached: { at: number; version: string; value: Promise<Structure> } | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly network: NetworkStateService,
  ) {}

  /**
   * The structure, computed at most every 10 s and shared by concurrent callers (callers get their own copy); a new
   * compiled revision or a placement change (replicas placed, moved, draining, removed) invalidates it at once.
   */
  private async structure(): Promise<Structure> {
    const version = await this.version();

    if (!this.cached || this.cached.version !== version || Date.now() - this.cached.at > STRUCTURE_TTL_MS) {
      const value = this.load();

      this.cached = { at: Date.now(), version, value };
      value.catch(() => {
        if (this.cached?.value === value) this.cached = null;
      });
    }

    const structure = await this.cached.value;

    return {
      ...structure,
      graph: { elements: [...structure.graph.elements], edges: [...structure.graph.edges] },
    };
  }

  /** Cheap fingerprint of what the structure is built from: compiled revision + placements (count, last change). */
  private async version(): Promise<string> {
    const [row] = (await this.dataSource.query(
      `SELECT (SELECT desired_revision FROM lw_cluster LIMIT 1) AS revision,
              (SELECT count(*) || '/' || coalesce(max(updated_at)::text, '') FROM lw_workload_placements) AS placements`,
    )) as { revision: number | null; placements: string | null }[];

    return `${row?.revision ?? 0}:${row?.placements ?? ''}`;
  }

  private async load(): Promise<Structure> {
    return await this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const loaded = await this.network.loadInput(manager);
      const health = new Map(
        ((await manager.query(`SELECT key, state FROM lw_health`)) as { key: string; state: string }[]).map((r) => [
          r.key,
          r.state,
        ]),
      );
      // Only the network part of each desired state.
      const states: {
        node_name: string;
        network: { wireguard?: { peer: string }[]; firewall?: { sets?: Record<string, string[]> } } | null;
      }[] = await manager.query(`SELECT node_name, state -> 'network' AS network FROM lw_node_desired_states`);
      const tunnels = new Map(states.map((s) => [s.node_name, (s.network?.wireguard ?? []).map((w) => w.peer)]));
      const sets = new Map(
        states.map((s) => [s.node_name, new Map(Object.entries(s.network?.firewall?.sets ?? {}))] as const),
      );
      const volumes = await manager.getRepository(VolumePlacementEntity).find();
      const addresses = await manager.getRepository(PublicAddressEntity).find();
      const exposures = collectExposures(loaded.workloads.parsed, statusPageHosts(loaded.resources));
      const statuses: { id: string; node: string; status: Record<string, { state: string }> | null }[] =
        await manager.query(`SELECT id, node, status FROM lw_workload_placements`);
      const replicaStates = new Map(statuses.map((p) => [p.id, p.status?.[p.node]?.state ?? 'unknown']));
      const graph = buildTopology(loaded.input, {
        health,
        tunnels,
        volumes,
        addresses: addresses.map((a) => ({ address: a.address, holder: a.holder, owner: a.owner })),
        hostnames: exposures.sites.map((s) => ({
          host: s.host,
          services: [...new Set(s.routes.map((r) => r.upstream.replace(/(\/udp)?:\d+$/, '')))],
        })),
        replicaStates,
      });
      // Autoscaling (3.23): range and last scaling on the replicas of autoscaled services.
      const autoscale = new Map(
        (
          (await manager.query(
            `SELECT service_key, replicas, last_scale_at, last_reason, status FROM lw_autoscale_state`,
          )) as (Parameters<typeof autoscaleMapData>[0] & { service_key: string })[]
        ).map((r) => [r.service_key, autoscaleMapData(r)] as const),
      );

      for (const e of graph.elements.filter((x) => x.kind === 'replica')) {
        const data = autoscale.get(
          e.id
            .replace(/^replica:/, '')
            .split('/')
            .slice(0, 3)
            .join('/'),
        );

        if (data) e.data = { ...e.data, ...data };
      }

      const elementOfAddress = new Map<string, string>();

      for (const n of loaded.input.nodes)
        for (const a of [n.overlayV4, n.overlayV6]) if (a) elementOfAddress.set(a.split('/')[0], `node:${n.name}`);

      for (const w of loaded.input.workloads)
        for (const a of w.addresses) elementOfAddress.set(a.split('/')[0], `replica:${w.id}`);

      return { graph, sets, elementOfAddress, input: loaded.input };
    });
  }

  async topology(req: RequestWithUser | undefined, q: TopologyQuery): Promise<TopologyResponse> {
    const caller = await this.access.caller(req);
    const at = q.at ? new Date(q.at) : new Date();

    if (Number.isNaN(at.getTime())) throw new BadRequestException('invalid time');

    const projects = readable(caller);

    // Nothing to see: no need to build anything.
    if (!caller.clusterRole && projects.size === 0) {
      if (q.plan) throw new NotFoundException('plan not found');

      return { elements: [], edges: [], at: at.toISOString() };
    }

    const { graph, sets, elementOfAddress, input } = await this.structure();
    const ids = new Set(graph.elements.map((e) => e.id));
    const addElements = (elements: readonly TopologyElement[]) => {
      for (const e of elements)
        if (!ids.has(e.id)) {
          ids.add(e.id);
          graph.elements.push(e);
        }
    };

    if (q.flows && caller.clusterRole) {
      const flows = await this.flows(at, sets, elementOfAddress);

      graph.edges.push(...flows.edges);
      addElements(flows.externals);
    }

    let overlay: TopologyResponse['overlay'];

    if (q.plan) {
      const plan = await this.dataSource.getRepository(PlanEntity).findOne({ where: { id: q.plan } });

      if (!plan || !planVisibleTo(caller, plan.changes)) throw new NotFoundException('plan not found');

      // Policies the plan creates or changes get their proposed edges (and new external peers) on the map.
      const proposed = plan.changes.flatMap((c) => {
        if (c.kind !== 'Policy' || (c.action !== 'create' && c.action !== 'update') || !c.after) return [];

        const spec = policySpecSchema.safeParse((c.after as { spec?: unknown }).spec);

        return spec.success ? [{ project: c.project ?? undefined, name: c.name, spec: spec.data }] : [];
      });
      const proposedGraph = buildTopology(
        { ...input, policies: proposed, workloadGroups: [], nodes: [] },
        { health: new Map(), tunnels: new Map(), volumes: [], addresses: [], hostnames: [], replicaStates: new Map() },
      );
      const proposedEdges = proposedGraph.edges.filter((e) => e.kind === 'policy');
      const edgeIds = new Set(graph.edges.map((e) => e.id));

      addElements(proposedGraph.elements.filter((e) => e.kind === 'external' || e.data['selector']));
      graph.edges.push(...proposedGraph.edges.filter((e) => e.kind === 'member' && !edgeIds.has(e.id)));

      for (const e of proposedEdges)
        if (!edgeIds.has(e.id)) graph.edges.push({ ...e, data: { ...e.data, proposed: true } });

      overlay = planOverlay(
        graph,
        plan.changes.map((c) => ({ action: c.action, kind: c.kind, name: c.name, project: c.project ?? null })),
      );

      for (const e of proposedEdges) overlay[e.id] ??= 'create';
    }

    const scoped = scopeTopology(graph, !!caller.clusterRole, projects);

    if (overlay && !caller.clusterRole) {
      // Only marks on what the caller sees.
      const visible = new Set([...scoped.elements.map((e) => e.id), ...scoped.edges.map((e) => e.id)]);

      overlay = Object.fromEntries(Object.entries(overlay).filter(([id]) => visible.has(id)));
    }

    return { ...scoped, at: at.toISOString(), ...(overlay ? { overlay } : {}) };
  }

  /** Flow edges of the minute before `at`, from the raw flows (or the hourly roll-up beyond their retention). */
  async flows(
    at: Date,
    sets: ReadonlyMap<string, ReadonlyMap<string, string[]>>,
    elementOfAddress: ReadonlyMap<string, string>,
  ): Promise<ReturnType<typeof flowEdges>> {
    const from = new Date(at.getTime() - FLOW_WINDOW_MS);
    const raw = Date.now() - from.getTime() <= 30 * 86_400_000;
    const rows: {
      node: string;
      policy: string;
      src: string;
      dst: string;
      protocol: string;
      port: number;
      decision: string;
      packets: string;
      bytes: string;
    }[] = raw
      ? await this.dataSource.query(
          `SELECT node, policy, src, dst, protocol, port, decision, sum(packets) AS packets, sum(bytes) AS bytes FROM lw_flows
             WHERE "time" > $1 AND "time" <= $2 GROUP BY 1, 2, 3, 4, 5, 6, 7 ORDER BY packets DESC LIMIT 2000`,
          [from, at],
        )
      : await this.dataSource.query(
          `SELECT node, policy, src, dst, protocol, port, decision, sum(packets) AS packets, sum(bytes) AS bytes FROM lw_flows_1h
             WHERE bucket = date_trunc('hour', $1::timestamptz) GROUP BY 1, 2, 3, 4, 5, 6, 7 ORDER BY packets DESC LIMIT 2000`,
          [at],
        );

    return flowEdges(
      rows.map((r) => ({ ...r, port: Number(r.port), packets: Number(r.packets), bytes: Number(r.bytes) })),
      sets,
      elementOfAddress,
      raw ? FLOW_WINDOW_MS / 1000 : 3600,
    );
  }

  /** The current minute's flows (the live view, cluster roles: computed once per tick for every subscriber). */
  async liveFlows(): Promise<TopologyEdge[]> {
    const { sets, elementOfAddress } = await this.structure();

    return (await this.flows(new Date(), sets, elementOfAddress)).edges;
  }

  /**
   * Path trace for a hostname (3.9): public addresses and their holders (the ingress), the services behind the
   * hostname, their replicas on their nodes and the deployments' volumes.
   */
  async trace(
    req: RequestWithUser | undefined,
    host: string,
  ): Promise<{ steps: { kind: string; id: string; label: string }[] }> {
    const caller = await this.access.caller(req);
    const { graph } = await this.structure();
    const hostname = graph.elements.find((e) => e.id === `hostname:${host.toLowerCase()}`);

    if (!hostname) throw new NotFoundException('hostname not found');

    const replicas = graph.edges
      .filter((e) => e.kind === 'exposure' && e.source === hostname.id)
      .map((e) => graph.elements.find((x) => x.id === e.target))
      .filter((x): x is NonNullable<typeof x> => !!x);
    const visibleReplicas = replicas.filter(
      (r) => !!caller.clusterRole || (r.project && canReadProject(caller, r.project)),
    );

    if (visibleReplicas.length === 0 && !caller.clusterRole) throw new NotFoundException('hostname not found');

    const ingress = caller.clusterRole
      ? graph.edges
          .filter(
            (e) =>
              e.kind === 'address' &&
              graph.elements
                .find((x) => x.id === e.source)
                ?.data['owner']?.toString()
                .startsWith('ingress'),
          )
          .map((e) => ({
            kind: 'address',
            id: e.source,
            label: `${e.source.slice('address:'.length)} → ${e.target.slice('node:'.length)}`,
          }))
      : [];
    const deployments = new Set(visibleReplicas.map((r) => `${r.project}/${r.data['deployment']}`));
    const volumes = graph.elements.filter(
      (e) => e.kind === 'volume' && deployments.has(e.id.slice('volume:'.length).split('/').slice(0, 2).join('/')),
    );

    return {
      steps: [
        { kind: 'hostname', id: hostname.id, label: hostname.label },
        ...ingress,
        ...visibleReplicas.map((r) => ({
          kind: 'replica',
          id: r.id,
          label: `${r.label}${caller.clusterRole && r.parent ? ` on ${r.parent.slice('node:'.length)}` : ''}`,
        })),
        ...volumes.map((v) => ({ kind: 'volume', id: v.id, label: v.id.slice('volume:'.length) })),
      ],
    };
  }
}

function readable(caller: AccessCaller): Set<string> {
  return new Set([...caller.projects.keys()].filter((p) => canReadProject(caller, p)));
}
