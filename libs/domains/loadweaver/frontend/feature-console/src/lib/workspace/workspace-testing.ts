import type { ConsoleResource, TopologyGraph } from '@forepath/loadweaver/frontend/data-access-console';

/** A small cluster for the Workspace specs: 2 sites, 3 nodes, a deployment on two nodes, a VM, a volume, a policy. */
export const WS_GRAPH: TopologyGraph = {
  at: '2026-10-27T10:00:00.000Z',
  elements: [
    { id: 'site:a', kind: 'site', label: 'a', data: { health: 'healthy' } },
    { id: 'site:b', kind: 'site', label: 'b', data: { health: 'degraded' } },
    { id: 'node:n1', kind: 'node', label: 'n1', parent: 'site:a', data: { health: 'healthy' } },
    { id: 'node:n2', kind: 'node', label: 'n2', parent: 'site:a', data: { health: 'healthy' } },
    { id: 'node:n3', kind: 'node', label: 'n3', parent: 'site:b', data: { health: 'degraded' } },
    {
      id: 'replica:shop/site/web/0',
      kind: 'replica',
      label: 'web/0',
      parent: 'node:n1',
      project: 'shop',
      data: { deployment: 'site', service: 'web', state: 'running', health: 'healthy' },
    },
    {
      id: 'replica:shop/site/web/1',
      kind: 'replica',
      label: 'web/1',
      parent: 'node:n2',
      project: 'shop',
      data: { deployment: 'site', service: 'web', state: 'running', health: 'degraded' },
    },
    {
      id: 'replica:shop/site/web/2',
      kind: 'replica',
      label: 'web/2',
      parent: 'node:n1',
      project: 'shop',
      data: { deployment: 'site', service: 'web', state: 'running', health: 'healthy' },
    },
    {
      id: 'replica:shop/lw-vm/db1/0',
      kind: 'replica',
      label: 'db1/0',
      parent: 'node:n3',
      project: 'shop',
      data: { deployment: 'lw-vm', service: 'db1', state: 'running', health: 'healthy' },
    },
    { id: 'volume:shop/site/data', kind: 'volume', label: 'data', project: 'shop', data: { health: 'healthy' } },
    { id: 'group:shop/frontend', kind: 'group', label: 'frontend', project: 'shop', data: { exposed: false } },
    { id: 'hostname:shop.example.com', kind: 'hostname', label: 'shop.example.com', data: {} },
    { id: 'external:0.0.0.0/0', kind: 'external', label: '0.0.0.0/0', data: {} },
  ],
  edges: [
    { id: 'tunnel:n1|n3', kind: 'tunnel', source: 'node:n1', target: 'node:n3', layer: 'tunnels', data: {} },
    {
      id: 'volume:shop/site/data:n2',
      kind: 'volume',
      source: 'volume:shop/site/data',
      target: 'node:n2',
      layer: 'storage',
      data: { role: 'primary' },
    },
    {
      id: 'policy:shop/to-db:group:shop/frontend->external:0.0.0.0/0',
      kind: 'policy',
      source: 'group:shop/frontend',
      target: 'external:0.0.0.0/0',
      layer: 'policies',
      data: { policy: 'shop/to-db' },
    },
    {
      id: 'exposure:shop.example.com:shop/lw-vm/db1/0',
      kind: 'exposure',
      source: 'hostname:shop.example.com',
      target: 'replica:shop/lw-vm/db1/0',
      layer: 'dns',
      data: {},
    },
    {
      id: 'flow:a',
      kind: 'flow',
      source: 'replica:shop/site/web/0',
      target: 'replica:shop/lw-vm/db1/0',
      layer: 'policies',
      data: { bytesPerSecond: 100 },
    },
    {
      id: 'flow:b',
      kind: 'flow',
      source: 'replica:shop/site/web/2',
      target: 'replica:shop/lw-vm/db1/0',
      layer: 'policies',
      data: { bytesPerSecond: 50 },
    },
  ],
};

const res = (kind: string, name: string, project?: string, spec: Record<string, unknown> = {}): ConsoleResource => ({
  apiVersion: 'loadweaver.com/v1',
  kind,
  metadata: { name, ...(project ? { project } : {}) },
  spec,
});

export const WS_RESOURCES: ConsoleResource[] = [
  res('Site', 'a'),
  res('Site', 'c'),
  res('Node', 'n1', undefined, { site: 'a' }),
  res('Deployment', 'site', 'shop'),
  res('Deployment', 'idle', 'shop'),
  res('VirtualMachine', 'db1', 'shop'),
  res('Policy', 'to-db', 'shop'),
  res('Policy', 'unused', 'shop'),
  res('Project', 'shop'),
  res('DnsZone', 'ex', undefined, { zone: 'example.com' }),
];
