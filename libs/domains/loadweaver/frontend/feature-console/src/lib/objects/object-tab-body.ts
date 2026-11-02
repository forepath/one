import type { ResourceKey } from '@forepath/loadweaver/frontend/data-access-console';

import { workloadMetricsEntity } from '../metrics/metrics-format';
import { WORKSPACE_VM_DEPLOYMENT } from '../workspace/workspace-model';
import type { TopologyScope } from '../topology/topology-view';
import type { ContentsScope } from './object-contents';
import type { ObjectPageKind, ObjectTabId } from './object-tabs';
import type { ResourceObjectRef } from './resources-context.service';

/**
 * A section page embedded in an object tab (3.38: link-only tabs render the real section view scoped to the object):
 * the page and the parameters it would otherwise read from its URL (`LW_SECTION_SCOPE`).
 */
export type ObjectSection =
  | 'members'
  | 'secrets'
  | 'dns'
  | 'metrics'
  | 'logs'
  | 'terminals'
  | 'updates'
  | 'files'
  | 'backups'
  | 'topology'
  | 'requests'
  | 'slos'
  | 'usage'
  | 'git';

/** What an object page tab renders (3.37): reused detail-page parts, Contents, history, or an embedded section page. */
export type ObjectTabBody =
  | { type: 'scope-summary'; project: string | null }
  | { type: 'site-summary' }
  | { type: 'contents'; scope: ContentsScope; preset: string }
  | { type: 'node' }
  | { type: 'vm'; part: 'summary' | 'console' | 'hardware' | 'snapshots' }
  | { type: 'resource'; key: ResourceKey; settings?: boolean }
  | { type: 'spec'; key: ResourceKey }
  | { type: 'policy'; key: ResourceKey }
  | { type: 'group-members'; key: ResourceKey }
  | { type: 'autoscaling'; project: string; deployment: string }
  | { type: 'health'; entity: string }
  | { type: 'history' }
  | { type: 'topology'; scope: TopologyScope }
  | { type: 'vm-images'; project: string }
  | { type: 'join-tokens'; site: string | null }
  | { type: 'section'; section: ObjectSection; params: Record<string, string> }
  | { type: 'none' };

export interface ObjectTabContext {
  pageKind: ObjectPageKind;
  ref: ResourceObjectRef;
  /** The resource behind the object (null for runtime-only objects and the cluster). */
  key: ResourceKey | null;
  /** Name of the cluster's `Cluster` resource (edited from the header, 2026-10-29). */
  clusterResource: string | null;
}

function section(name: ObjectSection, params: Record<string, string> = {}): ObjectTabBody {
  return { type: 'section', section: name, params };
}

/** A workload's Metrics tab: its replicas' series (entity prefix); nothing when the name can't form one. */
function metricsSection(project: string, entity: string): ObjectTabBody {
  return entity ? section('metrics', { project, entity }) : { type: 'none' };
}

/** The body of tab `tab` of an object page. */
export function objectTabBody(tab: ObjectTabId, context: ObjectTabContext): ObjectTabBody {
  const { pageKind, ref, key } = context;
  const name = ref.name ?? '';
  const project = ref.project ?? '';

  if (tab === 'history') return { type: 'history' };

  switch (pageKind) {
    case 'cluster':
      switch (tab) {
        case 'summary':
          return { type: 'scope-summary', project: null };
        case 'contents':
          return { type: 'contents', scope: { kind: 'cluster' }, preset: '' };
        case 'policies':
          return { type: 'contents', scope: { kind: 'cluster' }, preset: 'kind:Policy' };
        case 'topology':
          return { type: 'topology', scope: { kind: 'cluster' } };
        case 'permissions':
          return section('members');
        case 'tokens':
          return { type: 'join-tokens', site: null };
        default:
          return { type: 'none' };
      }
    case 'site':
      switch (tab) {
        case 'summary':
          return { type: 'site-summary' };
        case 'contents':
          return { type: 'contents', scope: { kind: 'site', name }, preset: '' };
        case 'topology':
          return { type: 'topology', scope: { kind: 'site', name } };
        case 'network':
          // Scoped internally (`site`), not through the search field: the user's search starts empty.
          return section('dns', { site: name });
        case 'tokens':
          return { type: 'join-tokens', site: name };
        default:
          return { type: 'none' };
      }
    case 'node':
      switch (tab) {
        case 'summary':
          return { type: 'node' };
        case 'workloads':
          return { type: 'contents', scope: { kind: 'node', name }, preset: '-kind:Volume' };
        case 'volumes':
          return { type: 'contents', scope: { kind: 'node', name }, preset: 'kind:Volume' };
        case 'health':
          return { type: 'health', entity: `node/${name}` };
        case 'metrics':
          return section('metrics', { node: name });
        case 'logs':
          return section('logs', { node: name });
        case 'shell':
          return section('terminals', { node: name });
        case 'updates':
          return section('updates', { q: name });
        default:
          return { type: 'none' };
      }
    case 'deployment':
      switch (tab) {
        case 'summary':
          return key ? { type: 'resource', key } : { type: 'none' };
        case 'spec':
          return key ? { type: 'spec', key } : { type: 'none' };
        case 'replicas':
          return { type: 'contents', scope: { kind: 'deployment', project, name }, preset: '' };
        case 'health':
          return { type: 'health', entity: `deployment/${project}/${name}` };
        case 'logs':
          return section('logs', { project, deployment: name });
        case 'metrics':
          return metricsSection(project, workloadMetricsEntity(project, name));
        case 'terminal':
          return section('terminals', { project, deployment: name });
        case 'files':
          return section('files', { project, deployment: name });
        case 'backups':
          return section('backups', { project, resource: name });
        case 'autoscaling':
          return { type: 'autoscaling', project, deployment: name };
        case 'network':
          return section('topology', { project, select: `deployment:${project}/${name}` });
        default:
          return { type: 'none' };
      }
    case 'virtualmachine':
      switch (tab) {
        case 'summary':
        case 'console':
        case 'hardware':
        case 'snapshots':
          return { type: 'vm', part: tab };
        // The full resource (form / YAML / draft) beside the friendly Hardware view.
        case 'spec':
          return key ? { type: 'spec', key } : { type: 'none' };
        case 'backups':
          return section('backups', {
            project,
            resource: `${WORKSPACE_VM_DEPLOYMENT}/${name}`,
          });
        case 'health':
          return { type: 'health', entity: `replica/${project}/${WORKSPACE_VM_DEPLOYMENT}/${name}/0` };
        case 'metrics':
          return metricsSection(project, workloadMetricsEntity(project, WORKSPACE_VM_DEPLOYMENT, name));
        case 'logs':
          return section('logs', {
            project,
            deployment: WORKSPACE_VM_DEPLOYMENT,
            service: name,
          });
        default:
          return { type: 'none' };
      }
    case 'volume': {
      const volume = key ? `${key.project ?? ''}/${key.name}` : `${project}/${name}`;

      switch (tab) {
        case 'summary':
          return key ? { type: 'resource', key } : { type: 'none' };
        case 'backups':
          return section('backups', { project, resource: name });
        case 'files':
          return section('files', { target: `volume:${volume}` });
        default:
          return { type: 'none' };
      }
    }
    case 'project':
      switch (tab) {
        case 'summary':
          return { type: 'scope-summary', project: name };
        case 'contents':
          return { type: 'contents', scope: { kind: 'project', name }, preset: '' };
        case 'topology':
          return { type: 'topology', scope: { kind: 'project', name } };
        case 'images':
          return { type: 'vm-images', project: name };
        case 'members':
          return section('members', { project: name });
        case 'secrets':
          return section('secrets', { project: name });
        case 'requests':
          return section('requests', { project: name });
        case 'slos':
          return section('slos', { project: name });
        case 'usage':
          return section('usage', { project: name });
        case 'git':
          return section('git', { project: name });
        default:
          return { type: 'none' };
      }
    case 'policy':
    case 'workloadgroup':
      if (!key) return { type: 'none' };

      switch (tab) {
        // Readable settings: the YAML is the Spec tab's (LW-12b).
        case 'summary':
          return { type: 'resource', key, settings: true };
        // A policy's members: its peers with their current members; a group's: the workloads it selects.
        case 'members':
          return pageKind === 'workloadgroup' ? { type: 'group-members', key } : { type: 'policy', key };
        case 'spec':
          return { type: 'spec', key };
        default:
          return { type: 'none' };
      }
    default:
      if (!key) return { type: 'none' };

      return tab === 'spec' ? { type: 'spec', key } : tab === 'summary' ? { type: 'resource', key } : { type: 'none' };
  }
}
