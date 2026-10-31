import {
  filterWorkspace,
  matchesWorkspaceSearch,
  workspaceAncestors,
  workspaceFacets,
  workspaceItemChange,
  workspaceModel,
  workspaceResourceId,
  workspaceRows,
  worstHealth,
  type WorkspaceItem,
} from './workspace-model';
import { WS_GRAPH, WS_RESOURCES } from './workspace-testing';

describe('workspaceModel (3.36)', () => {
  const model = workspaceModel(WS_GRAPH, WS_RESOURCES);
  const item = (id: string) => model.byId.get(id);

  it('builds containment sites ⊃ nodes ⊃ stacks ⊃ replicas, with one stack per service and node', () => {
    expect(item('node:n1')).toMatchObject({ parent: 'site:a', placement: 'a', drawn: true });
    expect(item('stack:shop/site/web@n1')).toMatchObject({
      parent: 'node:n1',
      elements: ['replica:shop/site/web/0', 'replica:shop/site/web/2'],
      data: expect.objectContaining({ replicas: 2 }),
    });
    expect(item('stack:shop/site/web@n2')?.elements).toEqual(['replica:shop/site/web/1']);
    expect(item('replica:shop/site/web/0')).toMatchObject({ parent: 'stack:shop/site/web@n1', status: 'running' });
    expect(item('site:a')?.children).toEqual(['node:n1', 'node:n2']);
  });

  it('synthesizes services and deployments from the replicas, with their worst health', () => {
    expect(item('service:shop/site/web')).toMatchObject({
      drawn: false,
      placed: true,
      health: 'degraded',
      elements: ['replica:shop/site/web/0', 'replica:shop/site/web/1', 'replica:shop/site/web/2'],
    });
    expect(item('deployment:shop/site')).toMatchObject({
      resource: { kind: 'Deployment', name: 'site', project: 'shop' },
    });
  });

  it('marks lw-vm replicas as VMs on their node and moves their edges to the VM', () => {
    expect(item('vm:shop/db1')).toMatchObject({
      kind: 'vm',
      parent: 'node:n3',
      typeName: 'VirtualMachine',
      elements: ['replica:shop/lw-vm/db1/0'],
      resource: { kind: 'VirtualMachine', name: 'db1', project: 'shop' },
    });
    expect(item('replica:shop/lw-vm/db1/0')).toBeUndefined();
    expect(model.edges.find((e) => e.id === 'exposure:shop.example.com:shop/lw-vm/db1/0')?.target).toBe('vm:shop/db1');
  });

  it('puts volumes on their primary node', () => {
    expect(item('volume:shop/site/data')).toMatchObject({ parent: 'node:n2', placement: 'n2' });
  });

  it('merges declared resources and fills the "Cluster & unplaced" tray', () => {
    expect(item('node:n1')?.resource).toEqual({ kind: 'Node', name: 'n1', project: null });
    // A site without nodes is still drawn (drop target).
    expect(item('site:c')).toMatchObject({ drawn: true, placed: true });
    expect(item('policy:shop/to-db')).toMatchObject({
      placed: true,
      elements: ['policy:shop/to-db:group:shop/frontend->external:0.0.0.0/0'],
    });
    expect(model.tray.map((i) => i.id).sort()).toEqual([
      'deployment:shop/idle',
      'policy:shop/unused',
      'resource:DnsZone//ex',
      'resource:Project//shop',
    ]);
  });

  it('maps resource keys to item ids', () => {
    expect(workspaceResourceId({ kind: 'WorkloadGroup', name: 'g', project: 'shop' })).toBe('group:shop/g');
    expect(workspaceResourceId({ kind: 'IpPool', name: 'p', project: null })).toBe('resource:IpPool//p');
  });

  it('derives overlay changes for aggregates', () => {
    expect(
      workspaceItemChange(item('stack:shop/site/web@n1') as WorkspaceItem, {
        'replica:shop/site/web/0': 'delete',
        'replica:shop/site/web/2': 'delete',
      }),
    ).toBe('delete');
    expect(
      workspaceItemChange(item('service:shop/site/web') as WorkspaceItem, { 'replica:shop/site/web/0': 'delete' }),
    ).toBe('update');
    expect(workspaceItemChange(item('node:n1') as WorkspaceItem, { 'node:n1': 'update' })).toBe('update');
    expect(workspaceItemChange(item('node:n1') as WorkspaceItem, null)).toBeNull();
  });

  it('searches, filters and lists table rows', () => {
    expect(matchesWorkspaceSearch(item('vm:shop/db1') as WorkspaceItem, 'DB1 shop')).toBe(true);
    expect(matchesWorkspaceSearch(item('vm:shop/db1') as WorkspaceItem, 'db1 blog')).toBe(false);

    const vms = filterWorkspace(model, { q: '', kinds: ['VirtualMachine'], projects: [], statuses: [] });

    expect([...vms]).toEqual(['vm:shop/db1']);
    expect([...filterWorkspace(model, { q: '', kinds: [], projects: [], statuses: ['degraded'] })]).toEqual(
      expect.arrayContaining(['site:b', 'node:n3', 'service:shop/site/web']),
    );
    expect(
      filterWorkspace(model, { q: '', kinds: [], projects: [], statuses: [], onlyChanged: new Set(['node:n1']) }),
    ).toEqual(new Set(['node:n1']));

    const rows = workspaceRows(model, null);

    expect(rows.some((r) => r.kind === 'replica' || r.kind === 'stack')).toBe(false);
    expect(rows[0].typeName <= rows[rows.length - 1].typeName).toBe(true);
    expect(workspaceFacets(model).kinds).toEqual(
      expect.arrayContaining(['Node', 'Service', 'VirtualMachine', 'Project']),
    );
  });

  it('walks ancestors and ranks health', () => {
    expect(workspaceAncestors(model, 'replica:shop/site/web/0')).toEqual([
      'stack:shop/site/web@n1',
      'node:n1',
      'site:a',
    ]);
    expect(worstHealth(['healthy', 'degraded', 'unknown'])).toBe('degraded');
    expect(worstHealth([])).toBe('unknown');
  });

  it('copes without a map (project members before the first load)', () => {
    const empty = workspaceModel(null, WS_RESOURCES);

    expect(empty.byId.get('deployment:shop/site')?.placed).toBe(false);
    expect(empty.edges).toEqual([]);
  });
});
