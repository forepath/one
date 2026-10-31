import { mayDraft, workspaceActions, workspaceFullPage, type WorkspaceAccess } from './workspace-actions';
import { workspaceModel, type WorkspaceItem } from './workspace-model';
import { WS_GRAPH, WS_RESOURCES } from './workspace-testing';

describe('workspaceActions (3.36)', () => {
  const model = workspaceModel(WS_GRAPH, WS_RESOURCES);
  const item = (id: string) => model.byId.get(id) as WorkspaceItem;
  const admin: WorkspaceAccess = { clusterRole: 'cluster-admin', projects: {}, fleetMode: false };
  const dev: WorkspaceAccess = { clusterRole: null, projects: { shop: 'developer' }, fleetMode: false };
  const viewer: WorkspaceAccess = { clusterRole: null, projects: { shop: 'viewer' }, fleetMode: false };
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

  it('offers node lifecycle actions with the confirm dialog, by role and lifecycle', () => {
    const node = { name: 'n1', lifecycle: 'active' as const, connected: false };
    const actions = workspaceActions(item('node:n1'), admin, { node });

    expect(ids(actions)).toEqual(
      expect.arrayContaining(['logs', 'metrics', 'health', 'node-cordon', 'node-drain', 'node-confirm-lost', 'edit']),
    );
    expect(actions.find((a) => a.id === 'node-confirm-lost')).toMatchObject({
      confirm: { danger: true },
      node: { name: 'n1', action: 'confirm-lost' },
    });
    // Nodes leave through their lifecycle, never by a deletion in the draft.
    expect(ids(actions)).not.toContain('delete');
    // Fleet mode: leave / confirm-lost need the admin grant (relay rules).
    expect(
      ids(workspaceActions(item('node:n1'), { ...admin, clusterRole: 'infra-operator', fleetMode: true }, { node })),
    ).not.toContain('node-confirm-lost');
    expect(ids(workspaceActions(item('node:n1'), dev, { node })).filter((i) => i.startsWith('node-'))).toEqual([]);
  });

  it('offers the VM actions the API lists, disruptive ones behind a confirm, snapshot for operators', () => {
    const vm = item('vm:shop/db1');
    const actions = workspaceActions(
      vm,
      { ...dev, projects: { shop: 'operator' } },
      { vmActions: ['reboot', 'force-off'] },
    );

    expect(ids(actions)).toEqual(expect.arrayContaining(['vm-console', 'vm-reboot', 'vm-force-off', 'vm-snapshot']));
    expect(actions.find((a) => a.id === 'vm-force-off')?.confirm?.danger).toBe(true);
    expect(ids(workspaceActions(vm, dev, {}))).not.toContain('vm-snapshot');
    expect(
      workspaceActions(vm, { ...admin, readOnly: true }, { vmActions: ['reboot'] }).some((a) => a.group !== 'link'),
    ).toBe(false);
  });

  it('hides draft actions without write access', () => {
    expect(mayDraft(item('deployment:shop/site'), dev)).toBe(true);
    expect(mayDraft(item('deployment:shop/site'), viewer)).toBe(false);
    expect(mayDraft(item('site:a'), dev)).toBe(false);
    expect(mayDraft(item('site:a'), { ...viewer, clusterRole: 'infra-operator' })).toBe(true);
    expect(mayDraft(item('resource:Project//shop'), { ...viewer, clusterRole: 'infra-operator' })).toBe(false);
    expect(ids(workspaceActions(item('replica:shop/site/web/0'), admin))).not.toContain('edit');
    expect(ids(workspaceActions(item('deployment:shop/site'), dev))).toEqual(
      expect.arrayContaining(['edit', 'delete', 'full-page']),
    );
    expect(ids(workspaceActions(item('deployment:shop/site'), viewer))).not.toContain('edit');
  });

  it('links replicas to terminal and files, stacks to their logs', () => {
    expect(workspaceActions(item('replica:shop/site/web/0'), dev).find((a) => a.id === 'terminal')).toMatchObject({
      route: ['/operate/terminals'],
      queryParams: { replica: 'shop/site/web/0' },
    });
    expect(workspaceActions(item('stack:shop/site/web@n1'), dev).find((a) => a.id === 'logs')?.queryParams).toEqual({
      project: 'shop',
      deployment: 'site',
      service: 'web',
    });
    expect(ids(workspaceActions(item('stack:shop/site/web@n1'), dev))).not.toContain('edit');
  });

  it('links stacks to their metrics by the replica entity prefix the metrics page reads', () => {
    const metrics = workspaceActions(item('stack:shop/site/web@n1'), dev).find((a) => a.id === 'metrics');

    expect(metrics).toMatchObject({ route: ['/observe/metrics'] });
    expect(metrics?.queryParams).toEqual({ project: 'shop', entity: 'shop/site/web/*' });
    expect(workspaceActions(item('node:n1'), dev).find((a) => a.id === 'metrics')?.queryParams).toEqual({ node: 'n1' });
  });

  it('opens the object pages as "open full page" targets', () => {
    expect(workspaceFullPage(item('node:n1'))?.route).toEqual(['/resources', 'node', 'n1']);
    expect(workspaceFullPage(item('vm:shop/db1'))?.route).toEqual(['/resources', 'virtualmachine', 'shop', 'db1']);
    expect(workspaceFullPage(item('policy:shop/to-db'))).toEqual({ route: ['/resources', 'policy', 'shop', 'to-db'] });
    expect(workspaceFullPage(item('external:0.0.0.0/0'))).toBeNull();
  });

  it('offers joining nodes on sites, backup now on volumes and DNS fail-backs (P2)', () => {
    expect(workspaceActions(item('site:a'), admin).find((a) => a.id === 'join-node')).toMatchObject({
      join: { site: 'a' },
    });
    // Through the fleet only cluster-wide admins join nodes.
    expect(
      ids(workspaceActions(item('site:a'), { ...admin, clusterRole: 'infra-operator', fleetMode: true })),
    ).not.toContain('join-node');
    expect(
      workspaceActions(item('volume:shop/site/data'), { ...dev, projects: { shop: 'operator' } }).find(
        (a) => a.id === 'backup-now',
      ),
    ).toMatchObject({ backup: { volume: 'shop/site/data' } });
    expect(ids(workspaceActions(item('volume:shop/site/data'), dev))).not.toContain('backup-now');

    const failover = { ...item('resource:DnsZone//ex'), resource: { kind: 'DnsFailover', name: 'www', project: null } };

    expect(
      workspaceActions(failover, admin, { failbackPending: true }).find((a) => a.id === 'dns-failback'),
    ).toMatchObject({ failback: { name: 'www' }, confirm: { danger: false } });
    expect(ids(workspaceActions(failover, admin, { failbackPending: false }))).not.toContain('dns-failback');
    expect(ids(workspaceActions(failover, dev, { failbackPending: true }))).not.toContain('dns-failback');
  });
});
