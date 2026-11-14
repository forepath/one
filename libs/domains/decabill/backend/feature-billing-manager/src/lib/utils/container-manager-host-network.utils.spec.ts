import {
  mergeHostNetworkingIntoTopology,
  parseIpAddrJson,
  parseIpRouteJson,
} from './container-manager-host-network.utils';

describe('container-manager-host-network.utils', () => {
  const addrSample = JSON.stringify([
    {
      ifname: 'lo',
      operstate: 'UNKNOWN',
      addr_info: [{ family: 'inet', local: '127.0.0.1', prefixlen: 8 }],
    },
    {
      ifname: 'eth0',
      operstate: 'UP',
      addr_info: [{ family: 'inet', local: '203.0.113.10', prefixlen: 24 }],
    },
    {
      ifname: 'br-abc123',
      operstate: 'UP',
      addr_info: [{ family: 'inet', local: '172.18.0.1', prefixlen: 16 }],
    },
  ]);
  const routeSample = JSON.stringify([
    { dst: 'default', gateway: '203.0.113.1', dev: 'eth0' },
    { dst: '172.18.0.0/16', dev: 'br-abc123' },
    { dst: '203.0.113.0/24', dev: 'eth0', protocol: 'kernel', scope: 'link' },
  ]);

  it('parses ip -j addr and skips loopback', () => {
    const interfaces = parseIpAddrJson(addrSample);

    expect(interfaces).toEqual([
      { name: 'eth0', state: 'UP', addresses: ['203.0.113.10/24'] },
      { name: 'br-abc123', state: 'UP', addresses: ['172.18.0.1/16'] },
    ]);
  });

  it('parses ip -j route', () => {
    const routes = parseIpRouteJson(routeSample);

    expect(routes).toEqual([
      { destination: 'default', gateway: '203.0.113.1', device: 'eth0' },
      { destination: '172.18.0.0/16', gateway: undefined, device: 'br-abc123' },
      { destination: '203.0.113.0/24', gateway: undefined, device: 'eth0' },
    ]);
  });

  it('returns empty arrays for invalid JSON', () => {
    expect(parseIpAddrJson('not-json')).toEqual([]);
    expect(parseIpRouteJson('{')).toEqual([]);
  });

  it('links Docker exit gateways to owning host ifaces and default egress to internet', () => {
    const hostInterfaces = parseIpAddrJson(addrSample);
    const hostRoutes = parseIpRouteJson(routeSample);
    const merged = mergeHostNetworkingIntoTopology({
      nodes: [
        { id: 'net:1', label: 'bridge', kind: 'network' },
        { id: 'exit:172.18.0.1', label: '172.18.0.1', kind: 'exit' },
      ],
      edges: [{ id: 'net-exit', from: 'net:1', to: 'exit:172.18.0.1', label: 'exit' }],
      hostInterfaces,
      hostRoutes,
    });

    expect(merged.nodes.some((node) => node.id === 'host_iface:br-abc123' && node.kind === 'host_iface')).toBe(true);
    expect(merged.nodes.some((node) => node.id === 'host_iface:eth0' && node.kind === 'host_iface')).toBe(true);
    expect(merged.nodes.some((node) => node.id === 'host_gw:203.0.113.1' && node.kind === 'host_gateway')).toBe(true);
    expect(merged.nodes.some((node) => node.id === 'internet' && node.kind === 'internet')).toBe(true);

    expect(
      merged.edges.some(
        (edge) =>
          edge.from === 'exit:172.18.0.1' && edge.to === 'host_iface:br-abc123' && edge.label === 'on br-abc123',
      ),
    ).toBe(true);
    expect(
      merged.edges.some(
        (edge) => edge.from === 'host_iface:br-abc123' && edge.to === 'host_iface:eth0' && edge.label === 'nat',
      ),
    ).toBe(true);
    expect(
      merged.edges.some(
        (edge) => edge.from === 'host_iface:eth0' && edge.to === 'host_gw:203.0.113.1' && edge.label === 'default',
      ),
    ).toBe(true);
    expect(merged.edges.some((edge) => edge.from === 'host_gw:203.0.113.1' && edge.to === 'internet')).toBe(true);
  });

  it('parses nexthop-style default routes from ip -j route', () => {
    const routes = parseIpRouteJson(
      JSON.stringify([
        {
          dst: 'default',
          nexthops: [{ gateway: '203.0.113.1', dev: 'eth0', weight: 1 }],
        },
      ]),
    );

    expect(routes).toEqual([{ destination: 'default', gateway: '203.0.113.1', device: 'eth0' }]);
  });

  it('keeps Docker topology unchanged when host data is empty', () => {
    const nodes = [{ id: 'exit:10.0.0.1', label: '10.0.0.1', kind: 'exit' as const }];
    const edges = [{ id: 'e1', from: 'net:1', to: 'exit:10.0.0.1' }];
    const merged = mergeHostNetworkingIntoTopology({
      nodes,
      edges,
      hostInterfaces: [],
      hostRoutes: [],
    });

    expect(merged.nodes).toEqual(nodes);
    expect(merged.edges).toEqual(edges);
  });
});
