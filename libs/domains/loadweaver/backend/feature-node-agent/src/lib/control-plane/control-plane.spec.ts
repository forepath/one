import type { ControlPlaneRole } from '@forepath/loadweaver/shared/util-agent-protocol';

import {
  controlPlaneApiSpec,
  controlPlaneImages,
  etcdSpec,
  postgresSpec,
  urlHost,
  type MemberContext,
} from './control-plane-containers';
import { componentsFor } from './control-plane-role.manager';
import { initialClusterFrom } from './etcd-client';

const role: ControlPlaneRole = {
  role: 'member',
  members: [
    { name: 'n1', address: '10.93.0.1', witness: false },
    { name: 'n2', address: '10.93.0.2', witness: false },
    { name: 'w', address: '10.93.0.9', witness: true },
  ],
  automaticFailover: true,
  scope: 'lw-abc',
  environment: {
    DB_PASSWORD: 'super',
    LOADWEAVER_POSTGRES_REPLICATION_PASSWORD: 'repl',
    LOADWEAVER_GRPC_HOSTNAMES: 'cp.example.com',
    ENCRYPTION_KEY: 'k',
  },
};
const ctx: MemberContext = {
  nodeName: 'n1',
  address: '10.93.0.1',
  stateDir: '/var/lib/loadweaver',
  images: controlPlaneImages({}),
};

describe('control-plane containers', () => {
  it('runs etcd on members and witnesses, Postgres and API only on members', () => {
    expect(componentsFor('member')).toEqual(['etcd', 'postgres', 'controlPlane']);
    expect(componentsFor('witness')).toEqual(['etcd']);
    expect(componentsFor('none')).toEqual([]);
  });

  it('pins every default image by digest except our own', () => {
    const images = controlPlaneImages({});

    expect(images.etcd).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(images.postgres).toMatch(/@sha256:[0-9a-f]{64}$/);
  });

  it('binds etcd to the overlay address and keeps the hash independent of the initial cluster', () => {
    const a = etcdSpec(ctx, role, 'new', 'n1=http://10.93.0.1:2380');
    const b = etcdSpec(ctx, role, 'existing', 'n1=http://10.93.0.1:2380,n2=http://10.93.0.2:2380');

    expect(a.cmd).toEqual(
      expect.arrayContaining([
        '--listen-peer-urls',
        'http://10.93.0.1:2380',
        '--listen-client-urls',
        'http://10.93.0.1:2379,http://127.0.0.1:2379',
        '--initial-cluster-token',
        'lw-abc',
      ]),
    );
    expect(a.hash).toBe(b.hash);
    expect(etcdSpec({ ...ctx, address: '127.0.0.1' }, role, 'new', '').cmd).toContain('http://127.0.0.1:2379');
    expect(etcdSpec({ ...ctx, address: '10.93.0.5' }, role, 'new', '').hash).not.toBe(a.hash);
  });

  it('points Patroni at every voter etcd and passes the shared credentials', () => {
    const spec = postgresSpec(ctx, role);

    expect(spec.env).toMatchObject({
      SCOPE: 'lw-abc',
      ETCD3_HOSTS: '10.93.0.1:2379,10.93.0.2:2379,10.93.0.9:2379',
      POD_IP: '10.93.0.1',
      PGPASSWORD_SUPERUSER: 'super',
      PGPASSWORD_STANDBY: 'repl',
    });
  });

  it('connects the API through the leader proxy and adds the overlay address to its certificate names', () => {
    const spec = controlPlaneApiSpec(ctx, role);

    expect(spec.env).toMatchObject({
      DB_HOST: '127.0.0.1',
      DB_PORT: '5433',
      ENCRYPTION_KEY: 'k',
      LOADWEAVER_GRPC_HOSTNAMES: 'cp.example.com,10.93.0.1',
    });
  });

  it('brackets IPv6 hosts and builds initial-cluster lists', () => {
    expect(urlHost('fd00::1')).toBe('[fd00::1]');
    expect(
      initialClusterFrom(
        [
          { ID: '1', name: 'n2', peerURLs: ['http://10.93.0.2:2380'] },
          { ID: '2', peerURLs: [] },
        ],
        { name: 'n1', peerUrl: 'http://10.93.0.1:2380' },
      ),
    ).toBe('n1=http://10.93.0.1:2380,n2=http://10.93.0.2:2380');
  });
});
