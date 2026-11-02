import type { DesiredState, NodeNetworkConfig } from '@forepath/loadweaver/shared/util-agent-protocol';

/** A small but complete compiled network config for node n1 (peer n2), used across agent tests. */
export function networkConfig(overrides: Partial<NodeNetworkConfig> = {}): NodeNetworkConfig {
  return {
    node: 'n1',
    addresses: ['10.93.0.1', 'fd00:93::1'],
    wireguard: [
      {
        interface: 'lw-0a1b2c3d',
        listenPort: 51820,
        peer: 'n2',
        peerPublicKey: 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=',
        peerEndpoint: 'n2.example.test:51821',
        allowedIps: ['10.88.1.10/32', '10.93.0.2/32', 'fd00:93::2/128'],
        addresses: ['10.93.0.1/32', 'fd00:93::1/128'],
        peerAddresses: ['10.93.0.2', 'fd00:93::2'],
        reasons: ['shop/web-to-api'],
      },
    ],
    services: [{ name: 'api.shop.lw', serviceIp: '10.92.0.10', backends: ['10.88.1.10'] }],
    bgp: {
      asn: 4200000000,
      routerId: '10.93.0.1',
      routeReflector: false,
      originate: ['10.88.0.0/24', '10.93.0.1/32', 'fd00:42::/80', 'fd00:93::1/128'],
      sessions: [
        {
          peer: 'n2',
          interface: 'lw-0a1b2c3d',
          peerAddress: 'fd00:93::2',
          peerAddresses: ['10.93.0.2', 'fd00:93::2'],
          role: 'peer',
          exports: ['10.88.0.0/24', '10.93.0.1/32', 'fd00:93::1/128'],
          imports: ['10.88.1.0/24', '10.93.0.2/32', 'fd00:93::2/128'],
        },
      ],
    },
    firewall: {
      sets: {
        lw_00000001: ['10.88.0.10/32', 'fd00:42::10/128'],
        lw_00000002: ['10.88.1.10/32'],
        lw_00000003: ['0.0.0.0/0', '::/0'],
      },
      rules: [
        {
          id: 'shop/web-to-api#1',
          policy: 'shop/web-to-api',
          chain: 'forward',
          srcSet: 'lw_00000001',
          dstSet: 'lw_00000002',
          protocol: 'tcp',
          ports: ['8080'],
          action: 'accept',
        },
        {
          id: 'shop/expose#2',
          policy: 'shop/expose',
          chain: 'forward',
          srcSet: 'lw_00000003',
          dstSet: 'lw_00000001',
          protocol: 'tcp',
          ports: ['443', '8000-8100'],
          action: 'observe',
        },
        {
          id: 'builtin:agent-api#3',
          policy: 'builtin:agent-api',
          chain: 'input',
          srcSet: 'lw_00000002',
          dstSet: 'lw_00000001',
          protocol: 'icmp',
          ports: [],
          action: 'accept',
        },
      ],
    },
    dns: {
      domain: 'lw',
      records: [{ name: 'api.shop.lw', addresses: ['10.92.0.10', 'fd00:92::10'] }],
      visibility: { '10.88.0.10': ['api.shop.lw'] },
    },
    ...overrides,
  };
}

export function desiredState(revision = 1, overrides: Partial<DesiredState> = {}): DesiredState {
  return {
    revision,
    network: networkConfig(),
    controlPlane: { role: 'none', members: [], automaticFailover: false, scope: 'c1' },
    workloads: [],
    volumes: [],
    lifecycle: 'active',
    ...overrides,
  };
}

/** One entry of {@link tarArchive}: a ustar header (plus a pax header for `pax` records) and its data. */
export interface TarFixtureEntry {
  name: string;
  /** ustar type flag: '0' file, '1' hardlink, '2' symlink, '3' char, '5' dir, '6' fifo, … */
  type?: string;
  data?: string | Buffer;
  mode?: number;
  uid?: number;
  gid?: number;
  linkname?: string;
  mtime?: number;
  pax?: Record<string, string | Buffer>;
}

function tarHeader(e: Required<Pick<TarFixtureEntry, 'name' | 'type'>> & TarFixtureEntry, size: number): Buffer {
  const block = Buffer.alloc(512);
  const put = (value: string, offset: number, length: number) => block.write(value, offset, length, 'utf8');
  const octal = (value: number, offset: number, length: number) =>
    put(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, length);

  put(e.name, 0, 100);
  octal(e.mode ?? 0o644, 100, 8);
  octal(e.uid ?? 0, 108, 8);
  octal(e.gid ?? 0, 116, 8);
  octal(size, 124, 12);
  octal(e.mtime ?? 1_700_000_000, 136, 12);
  block.fill(0x20, 148, 156);
  put(e.type, 156, 1);
  put(e.linkname ?? '', 157, 100);
  put('ustar\0', 257, 6);
  put('00', 263, 2);

  let sum = 0;

  for (const byte of block) sum += byte;

  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);

  return block;
}

function padded(data: Buffer): Buffer {
  return Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}

/** A tar archive for unpack tests (crafted entries, pax records), ending with two zero blocks. */
export function tarArchive(entries: TarFixtureEntry[]): Buffer {
  const parts: Buffer[] = [];

  for (const entry of entries) {
    if (entry.pax) {
      const records = Object.entries(entry.pax).map(([key, value]) => {
        const body = Buffer.concat([Buffer.from(` ${key}=`), Buffer.from(value), Buffer.from('\n')]);
        let length = body.length + 1;

        while (String(length).length + body.length !== length) length = String(length).length + body.length;

        return Buffer.concat([Buffer.from(String(length)), body]);
      });
      const data = Buffer.concat(records);

      parts.push(tarHeader({ name: 'PaxHeader', type: 'x' }, data.length), padded(data));
    }

    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '');
    const type = entry.type ?? '0';

    parts.push(tarHeader({ ...entry, type }, type === '0' ? data.length : 0));

    if (type === '0') parts.push(padded(data));
  }

  parts.push(Buffer.alloc(1024));

  return Buffer.concat(parts);
}
