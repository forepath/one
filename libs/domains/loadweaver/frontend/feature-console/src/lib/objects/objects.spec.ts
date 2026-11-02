import { factLabel } from './tabs/object-parts.component';
import { fpcFlattenTree, fpcTreeBranchIds } from '@forepath/shared/frontend/ui-components';

import { workspaceModel } from '../workspace/workspace-model';
import { WS_GRAPH, WS_RESOURCES } from '../workspace/workspace-testing';
import { landingCommands } from '../guards/landing.guard';
import { contentsCreateTarget, contentsQueryFromParams, contentsRows, removeContentsTerm } from './object-contents';
import { parseSearch } from '../list-search';
import { objectHistoryTarget, plansTouching } from './object-history';
import { routeObjectRef } from './object-page.component';
import { objectKeyFromParams, objectRefFromUrl, objectRoute, resourceObjectRoute } from './object-route';
import { objectTabBody } from './object-tab-body';
import type { ResourceObjectRef } from './resources-context.service';
import { objectPageKind, objectTabs, OBJECT_TAB_SETS, resolveObjectTab } from './object-tabs';
import {
  buildResourceTree,
  defaultTreeView,
  itemSearchDocument,
  treeNodeIdsFor,
  treeStatus,
  type ResourceTreeOptions,
  fleetTreeExpanded,
  fleetTreeRoots,
  builtinMemberEntry,
  BUILTIN_MEMBER_TREE_ID,
} from './resource-tree';

const options: ResourceTreeOptions = {
  labels: {
    cluster: 'Cluster',
    unplaced: 'Unplaced & cluster-level',
    projects: 'Projects',
    clusterLevel: 'Cluster-level',
    favourites: 'Favourites',
    noLabels: 'No labels',
    changed: 'Changed in the draft',
  },
};

describe('object routes', () => {
  it('maps resources and items to object pages', () => {
    expect(resourceObjectRoute({ kind: 'Node', name: 'n1', project: null })).toEqual(['/resources', 'node', 'n1']);
    expect(resourceObjectRoute({ kind: 'Project', name: 'shop', project: null })).toEqual([
      '/resources',
      'project',
      'shop',
    ]);
    expect(resourceObjectRoute({ kind: 'VirtualMachine', name: 'db1', project: 'shop' })).toEqual([
      '/resources',
      'virtualmachine',
      'shop',
      'db1',
    ]);
    expect(resourceObjectRoute({ kind: 'IpPool', name: 'pool', project: null })).toEqual([
      '/resources',
      'ippool',
      '-',
      'pool',
    ]);
    expect(
      objectRoute({ kind: 'stack', label: 'web', resource: null, project: 'shop', data: { deployment: 'site' } }),
    ).toEqual(['/resources', 'deployment', 'shop', 'site']);
    expect(objectRoute({ kind: 'address', label: '10.0.0.1', resource: null, project: null, data: {} })).toBeNull();
  });

  it('parses route params', () => {
    expect(objectKeyFromParams({ kind: 'ippool', project: '-', name: 'pool' })).toEqual({
      kind: 'ippool',
      project: null,
      name: 'pool',
    });
    expect(objectKeyFromParams({ kind: 'deployment', project: 'shop', name: 'site' })?.project).toBe('shop');
    expect(objectKeyFromParams({ kind: null, name: 'x' })).toBeNull();
  });
});

describe('object tabs', () => {
  const admin = { infrastructure: true, clusterAdmin: true, fleetMode: false, joinNodes: true };
  const member = { infrastructure: false, clusterAdmin: false, fleetMode: false };

  it('has the decided full sets', () => {
    expect(objectTabs('Cluster', admin).map((tab) => tab.id)).toEqual(OBJECT_TAB_SETS.cluster);
    expect(objectTabs('VirtualMachine', admin).map((tab) => tab.id)).toEqual(OBJECT_TAB_SETS.virtualmachine);
    expect(objectTabs('Deployment', admin)).toHaveLength(12);
    expect(objectTabs('IpPool', admin).map((tab) => tab.id)).toEqual(['summary', 'spec', 'history']);
    expect(objectPageKind('WorkloadGroup')).toBe('workloadgroup');
  });

  it('hides tabs by role and fleet grant', () => {
    // No Options tab any more (2026-10-29): the Cluster resource is edited from the header like every resource.
    expect(objectTabs('Cluster', admin).map((tab) => tab.id)).not.toContain('options');
    expect(objectTabs('Cluster', member).map((tab) => tab.id)).not.toContain('permissions');
    expect(objectTabs('Node', member).map((tab) => tab.id)).not.toContain('shell');
    expect(objectTabs('Cluster', member).map((tab) => tab.id)).not.toContain('tokens');
    expect(objectTabs('Site', { ...admin, joinNodes: false }).map((tab) => tab.id)).not.toContain('tokens');
    expect(objectTabs('Site', admin).map((tab) => tab.id)).toContain('tokens');
    expect(objectTabs('Deployment', { ...member, fleetMode: true }).map((tab) => tab.id)).not.toContain('files');
    expect(objectTabs('Deployment', { ...admin, fleetMode: true }).map((tab) => tab.id)).toContain('files');
  });

  it('falls back to Summary for an unknown or hidden tab', () => {
    const tabs = objectTabs('Node', member);

    expect(resolveObjectTab(tabs, 'logs')).toBe('logs');
    expect(resolveObjectTab(tabs, 'shell')).toBe('summary');
    expect(resolveObjectTab(tabs, null)).toBe('summary');
  });
});

describe('resource tree', () => {
  const model = workspaceModel(WS_GRAPH, WS_RESOURCES);

  it('defaults by role and maps health to dots', () => {
    expect(defaultTreeView(true)).toBe('placement');
    expect(defaultTreeView(false)).toBe('projects');
    expect(treeStatus('critical')).toBe('danger');
    expect(treeStatus('degraded')).toBe('warning');
    expect(treeStatus(null)).toBeNull();
  });

  it('builds Cluster → sites → nodes → workloads (placement)', () => {
    const tree = buildResourceTree(model, 'placement', options);
    const rows = fpcFlattenTree(tree, new Set(fpcTreeBranchIds(tree)));

    expect(tree.map((node) => node.id)).toEqual(['cluster']);
    expect(tree[0].data?.route).toEqual(['/resources', 'cluster']);
    expect(tree[0].children?.map((node) => node.id).slice(0, 2)).toEqual(['site:a', 'site:b']);
    expect(rows.find((row) => row.node.id === 'node:n1')?.level).toBe(3);
    // The VM runs on n3 (site b).
    const vm = rows.find((row) => row.node.data?.item?.kind === 'vm');
    expect(vm?.parentId).toBe('node:n3');
    expect(vm?.node.data?.route?.[1]).toBe('virtualmachine');
  });

  it('builds Projects → kinds → items, plus cluster-level items', () => {
    const tree = buildResourceTree(model, 'projects', options);

    expect(tree[0].id).toBe('group:projects');
    const shop = tree[0].children?.find((node) => node.id === 'project:shop');
    expect(shop?.data?.route).toEqual(['/resources', 'project', 'shop']);
    expect(shop?.children?.map((node) => node.label)).toContain('Deployment');
  });

  it('builds kind and label views, pins favourites and marks draft changes', () => {
    const vmId = model.items.find((item) => item.kind === 'vm')?.id as string;
    const tree = buildResourceTree(model, 'kind', {
      ...options,
      favourites: [vmId, 'missing'],
      changed: new Set([vmId]),
    });

    expect(tree[0].id).toBe('group:favourites');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children?.[0].mark).toBe(true);
    expect(treeNodeIdsFor(vmId, tree).length).toBeGreaterThanOrEqual(2);
    expect(tree.some((node) => node.id === 'kind:VirtualMachine')).toBe(true);

    const labels = buildResourceTree(model, 'labels', options);
    expect(labels.length).toBeGreaterThan(0);
  });

  it('shows the built-in control-plane member read-only next to the nodes (3.39)', () => {
    const labels = {
      label: 'Control plane (built-in)',
      active: 'Active key holder',
      standby: 'Standby',
      participant: 'Key holder',
      problem: 'Seal key problem',
      activeHint: 'a',
      standbyHint: 's',
      participantHint: 'p',
      problemHint: 'x',
    };
    const member = {
      mode: 'auto' as const,
      state: 'ok' as const,
      role: 'standby' as const,
      holder: false,
      standby: true,
      realMembers: 2,
      instance: 'cp',
      lastSeenAt: null,
    };

    expect(builtinMemberEntry(member, labels)).toMatchObject({ status: 'secondary', statusLabel: 'Standby' });
    expect(builtinMemberEntry({ ...member, role: 'active', holder: true }, labels)).toMatchObject({
      status: 'success',
      statusLabel: 'Active key holder',
    });
    expect(builtinMemberEntry({ ...member, state: 'key-mismatch' }, labels)?.status).toBe('danger');
    expect(builtinMemberEntry({ ...member, mode: 'off', role: 'off' }, labels)).toBeNull();
    expect(builtinMemberEntry(undefined, labels)).toBeNull();

    const tree = buildResourceTree(model, 'placement', { ...options, builtin: builtinMemberEntry(member, labels) });
    const entry = tree[0].children?.[0];

    expect(entry).toMatchObject({ id: BUILTIN_MEMBER_TREE_ID, label: 'Control plane (built-in)', hint: 's' });
    // No object page, no actions, no children: not a node.
    expect(entry?.data).toEqual({ item: null, route: null });
    expect(entry?.children).toBeUndefined();
    // The Cluster badge counts placement children only, not the built-in entry.
    const without = buildResourceTree(model, 'placement', options);

    expect(tree[0].badge).toBe(without[0].badge);
    expect(
      buildResourceTree(model, 'kind', { ...options, builtin: builtinMemberEntry(member, labels) })[0].id,
    ).not.toBe(BUILTIN_MEMBER_TREE_ID);
  });
});

describe('object pages (P2)', () => {
  const model = workspaceModel(WS_GRAPH, WS_RESOURCES);
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

  it('parses object URLs and create routes', () => {
    expect(objectRefFromUrl('/resources/cluster?tab=contents')).toEqual({ kind: 'cluster', project: null, name: null });
    expect(objectRefFromUrl('/de/resources/node/n1')).toEqual({ kind: 'node', project: null, name: 'n1' });
    expect(objectRefFromUrl('/resources/virtualmachine/shop/db1')).toEqual({
      kind: 'virtualmachine',
      project: 'shop',
      name: 'db1',
    });
    expect(objectRefFromUrl('/resources/ippool/-/pool')).toEqual({ kind: 'ippool', project: null, name: 'pool' });
    expect(objectRefFromUrl('/observe/health')).toBeNull();
  });

  it('lists the contents of a scope', () => {
    const cluster = ids(contentsRows(model, { kind: 'cluster' }));

    expect(cluster).toEqual(expect.arrayContaining(['site:a', 'node:n1', 'vm:shop/db1', 'policy:shop/to-db']));
    expect(cluster).not.toContain('replica:shop/site/web/0');

    const siteA = ids(contentsRows(model, { kind: 'site', name: 'a' }));

    expect(siteA).toEqual(expect.arrayContaining(['node:n1', 'node:n2']));
    expect(siteA).not.toContain('site:a');
    expect(siteA).not.toContain('node:n3');
    expect(ids(contentsRows(model, { kind: 'project', name: 'shop' })).every((id) => !id.startsWith('site:'))).toBe(
      true,
    );
    expect(ids(contentsRows(model, { kind: 'deployment', project: 'shop', name: 'site' }))).toEqual(
      expect.arrayContaining(['replica:shop/site/web/0', 'replica:shop/site/web/1']),
    );
  });

  it('merges link filters into the search and removes chips', () => {
    expect(contentsQueryFromParams({ kind: 'VirtualMachine', project: 'shop' })).toBe(
      'kind:VirtualMachine project:shop',
    );
    expect(contentsQueryFromParams({ q: 'web kind:Node', kind: 'Node' })).toBe('web kind:Node');
    expect(removeContentsTerm('web kind:Node', 'kind:Node')).toBe('web');
  });

  it('maps tabs to their bodies', () => {
    const ctx = (
      pageKind: Parameters<typeof objectTabBody>[1]['pageKind'],
      ref: ResourceObjectRef,
      key = null as never,
    ) => ({
      pageKind,
      ref,
      key,
      clusterResource: 'prod',
    });
    const cluster = { kind: 'cluster', project: null, name: null };

    expect(objectTabBody('summary', ctx('cluster', cluster))).toEqual({ type: 'scope-summary', project: null });
    expect(objectTabBody('policies', ctx('cluster', cluster))).toMatchObject({
      type: 'contents',
      preset: 'kind:Policy',
    });
    expect(objectTabBody('health', ctx('node', { kind: 'node', project: null, name: 'n1' }))).toEqual({
      type: 'health',
      entity: 'node/n1',
    });
    expect(
      objectTabBody('console', ctx('virtualmachine', { kind: 'virtualmachine', project: 'shop', name: 'db1' })),
    ).toEqual({
      type: 'vm',
      part: 'console',
    });
    expect(objectTabBody('tokens', ctx('site', { kind: 'site', project: null, name: 'a' }))).toEqual({
      type: 'join-tokens',
      site: 'a',
    });
    expect(objectTabBody('tokens', ctx('cluster', { kind: 'cluster', project: null, name: null }))).toEqual({
      type: 'join-tokens',
      site: null,
    });
    const vmKey = { kind: 'VirtualMachine', name: 'db1', project: 'shop' };

    expect(
      objectTabBody('spec', {
        ...ctx('virtualmachine', { kind: 'virtualmachine', project: 'shop', name: 'db1' }),
        key: vmKey,
      }),
    ).toEqual({ type: 'spec', key: vmKey });
    expect(OBJECT_TAB_SETS.virtualmachine).toContain('spec');
    expect(objectTabBody('logs', ctx('node', { kind: 'node', project: null, name: 'n1' }))).toMatchObject({
      type: 'section',
      section: 'logs',
      params: { node: 'n1' },
    });
    // Metrics tabs: the replica entity prefix the metrics API matches (replica ids `<project>/<deployment>/…`).
    expect(objectTabBody('metrics', ctx('deployment', { kind: 'deployment', project: 'shop', name: 'site' }))).toEqual({
      type: 'section',
      section: 'metrics',
      params: { project: 'shop', entity: 'shop/site/*' },
    });
    expect(
      objectTabBody('metrics', ctx('virtualmachine', { kind: 'virtualmachine', project: 'shop', name: 'db1' })),
    ).toEqual({ type: 'section', section: 'metrics', params: { project: 'shop', entity: 'shop/lw-vm/db1/*' } });
    expect(objectTabBody('metrics', ctx('deployment', { kind: 'deployment', project: null, name: 'site' }))).toEqual({
      type: 'none',
    });
    expect(objectTabBody('metrics', ctx('node', { kind: 'node', project: null, name: 'n1' }))).toMatchObject({
      params: { node: 'n1' },
    });
    expect(objectTabBody('requests', ctx('project', { kind: 'project', project: null, name: 'shop' }))).toEqual({
      type: 'section',
      section: 'requests',
      params: { project: 'shop' },
    });
    expect(objectTabBody('history', ctx('site', { kind: 'site', project: null, name: 'a' }))).toEqual({
      type: 'history',
    });
    const policy = { kind: 'Policy', name: 'to-db', project: 'shop' };

    expect(
      objectTabBody('members', { ...ctx('policy', { kind: 'policy', project: 'shop', name: 'to-db' }), key: policy }),
    ).toEqual({ type: 'policy', key: policy });
  });

  it('builds the task history query and filters plans by their changes', () => {
    const vm = objectHistoryTarget({ kind: 'virtualmachine', project: 'shop', name: 'db1' }, 'VirtualMachine');

    expect(vm.audit).toEqual({ limit: 100, target: 'virtual-machine/shop/db1' });

    const dep = objectHistoryTarget({ kind: 'deployment', project: 'shop', name: 'site' }, 'Deployment');

    expect(dep.audit).toEqual({ limit: 100, text: 'site', project: 'shop' });

    const plan = (id: string, kind: string, name: string, project: string | null) =>
      ({ id, changes: [{ kind, name, project }] }) as never;

    expect(
      plansTouching([plan('p1', 'Deployment', 'site', 'shop'), plan('p2', 'Deployment', 'site', 'prod')], dep).map(
        (p: { id: string }) => p.id,
      ),
    ).toEqual(['p1']);
    expect(objectHistoryTarget({ kind: 'cluster', project: null, name: null }, 'Cluster').resource).toBeNull();
  });

  it('lands cluster roles on the cluster and members on their first project', () => {
    expect(landingCommands({ clusterRole: 'auditor', projects: {} })).toEqual(['/resources', 'cluster']);
    expect(landingCommands({ clusterRole: null, projects: { web: 'viewer', api: 'admin' } })).toEqual([
      '/resources',
      'project',
      'api',
    ]);
    expect(landingCommands(null)).toEqual(['/resources', 'cluster']);
  });

  it('reads the object of a route', () => {
    const get = (values: Record<string, string>) => ({ get: (k: string) => values[k] ?? null });

    expect(routeObjectRef({ objectKind: 'cluster' }, get({}))).toEqual({ kind: 'cluster', project: null, name: null });
    expect(routeObjectRef({ objectKind: 'node' }, get({ name: 'n1' }))).toEqual({
      kind: 'node',
      project: null,
      name: 'n1',
    });
    expect(routeObjectRef({}, get({ kind: 'VirtualMachine', project: '-', name: 'x' }))).toEqual({
      kind: 'virtualmachine',
      project: null,
      name: 'x',
    });
  });

  it('describes items for the search syntax', () => {
    const doc = itemSearchDocument(model.byId.get('node:n1')!);

    expect(doc.fields['kind']).toBe('Node');
    expect(doc.fields['site']).toBe('a');
  });
});

describe('fleet root of the resource tree (3.37 P7)', () => {
  it("puts Fleet → Clusters above the active cluster's own tree; other clusters load on demand", () => {
    const own = [{ id: 'cluster', label: 'Cluster', data: { item: null, route: ['/resources', 'cluster'] } }];
    const roots = fleetTreeRoots(
      [
        { id: 'b', name: 'beta', health: 'unreachable' },
        { id: 'a', name: 'alpha', health: 'healthy' },
      ],
      'a',
      own,
      { fleet: 'Fleet', clusters: 'Clusters' },
    );
    const clusters = roots[0].children?.[0];

    expect(roots.map((n) => n.id)).toEqual(['fleet']);
    expect(clusters?.badge).toBe(2);
    expect(clusters?.children?.map((n) => [n.label, n.status, !!n.children, !!n.hasChildren])).toEqual([
      ['alpha', 'success', true, false],
      ['beta', 'danger', false, true],
    ]);
    expect(clusters?.children?.[0].children).toBe(own);
    expect(clusters?.children?.[1].data?.clusterId).toBe('b');
    expect(fleetTreeExpanded('a')).toEqual(['fleet', 'fleet:clusters', 'fleet-cluster:a']);
    expect(fleetTreeExpanded(null)).toEqual(['fleet', 'fleet:clusters']);
  });
});

describe('object facts labels (D7, LW-23)', () => {
  it('turns model data keys into sentence-case labels', () => {
    expect(factLabel('lastSeen')).toBe('Last seen');
    expect(factLabel('service_id')).toBe('Service id');
    expect(factLabel('region')).toBe('Region');
  });
});

describe('contents table-head create (single-kind tables only, 2026-10-29)', () => {
  const kinds = ['Policy', 'BackupTarget', 'Cluster', 'StatusPage'];
  const target = (q: string, scope: Parameters<typeof contentsCreateTarget>[1] = { kind: 'cluster' }) =>
    contentsCreateTarget(parseSearch(q), scope, kinds);

  it('offers the kind of a one-kind filter, with the project context', () => {
    expect(target('kind:Policy')).toEqual({ kind: 'Policy', project: null });
    expect(target('kind:backuptarget')).toEqual({ kind: 'BackupTarget', project: null });
    expect(target('kind:StatusPage project:shop')).toEqual({ kind: 'StatusPage', project: 'shop' });
    expect(target('kind:Policy', { kind: 'project', name: 'shop' })).toEqual({ kind: 'Policy', project: 'shop' });
  });

  it('offers nothing for mixed, excluded, unknown or non-creatable kinds', () => {
    expect(target('')).toBeNull();
    expect(target('-kind:Volume')).toBeNull();
    expect(target('kind:Policy kind:StatusPage')).toBeNull();
    expect(target('kind:Volume')).toBeNull();
    expect(target('kind:Cluster')).toBeNull();
    expect(target('kind:Policy', { kind: 'node', name: 'n1' })).toBeNull();
  });
});
