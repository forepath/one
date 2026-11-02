import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';

import type { GroupMember, GroupMembers, PolicySpec, WorkloadGroupSpec } from '../types/policies.types';
import type { ConsoleResource } from '../types/resources.types';
import { ConsoleApi } from './console-api';

/** The parts of `GET /topology` the groups view reads (replicas and `member` edges). */
export interface GroupMembershipTopology {
  elements: { id: string; kind: string; label: string; project?: string | null; data?: Record<string, unknown> }[];
  edges: { id: string; kind: string; source: string; target: string }[];
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Members per group (`group:<project>/<name>` → replicas), from the map's `member` edges. */
export function groupMembersFromTopology(topology: GroupMembershipTopology): GroupMembers {
  const replicas = new Map(topology.elements.filter((e) => e.kind === 'replica').map((e) => [e.id, e]));
  const members: GroupMembers = {};

  for (const edge of topology.edges) {
    if (edge.kind !== 'member' || !edge.source.startsWith('group:')) continue;

    const replica = replicas.get(edge.target);
    const member: GroupMember = {
      replica: edge.target.replace(/^replica:/, ''),
      label: replica?.label ?? edge.target.replace(/^replica:/, ''),
      deployment: text(replica?.data?.['deployment']),
      service: text(replica?.data?.['service']),
      state: text(replica?.data?.['state']),
      health: text(replica?.data?.['health']),
    };
    const key = edge.source.slice('group:'.length);

    (members[key] ??= []).push(member);
  }

  return members;
}

/** Groups & policies (3.3): `WorkloadGroup` / `Policy` resources and who is in which group right now. */
@Injectable({ providedIn: 'root' })
export class PoliciesService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  workloadGroups(): Observable<ConsoleResource<WorkloadGroupSpec>[]> {
    return this.http.get<ConsoleResource<WorkloadGroupSpec>[]>(this.url('/resources'), {
      params: { kind: 'WorkloadGroup' },
    });
  }

  policies(): Observable<ConsoleResource<PolicySpec>[]> {
    return this.http.get<ConsoleResource<PolicySpec>[]>(this.url('/resources'), { params: { kind: 'Policy' } });
  }

  /** Current members per group (scoped by access like the map). */
  members(): Observable<GroupMembers> {
    return this.http.get<GroupMembershipTopology>(this.url('/topology')).pipe(map(groupMembersFromTopology));
  }
}
