import type { ControlPlaneRole } from '@forepath/loadweaver/shared/util-agent-protocol';

import {
  controlPlaneApiSpec,
  controlPlaneImages,
  etcdSpec,
  postgresSpec,
  queueSpec,
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
    expect(componentsFor('member')).toEqual(['etcd', 'postgres', 'queue', 'controlPlane']);
    expect(componentsFor('witness')).toEqual(['etcd']);
    expect(componentsFor('none')).toEqual([]);
  });

  it("keeps the API replica stopped while the cluster's database isn't on the members yet (3.43)", () => {
    expect(componentsFor('member', 'pending')).toEqual(['etcd', 'postgres', 'queue']);
    expect(componentsFor('member', 'ready')).toEqual(['etcd', 'postgres', 'queue', 'controlPlane']);
    expect(componentsFor('witness', 'pending')).toEqual(['etcd']);
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

  it("points Patroni at the member's own etcd and passes the shared credentials", () => {
    const spec = postgresSpec(ctx, role);

    expect(spec.env).toMatchObject({
      SCOPE: 'lw-abc',
      ETCD3_HOSTS: '127.0.0.1:2379',
      PGPASSWORD_SUPERUSER: 'super',
      PGPASSWORD_STANDBY: 'repl',
    });
    // Spilo's local provider ignores POD_IP; it only re-created Postgres on the loopback → overlay switch.
    expect(spec.env).not.toHaveProperty('POD_IP');
  });

  it("advertises the member's overlay address as Patroni's connect addresses, not Spilo's hostname lookup (3.43)", () => {
    expect(postgresSpec(ctx, role).env).toMatchObject({
      PG_CONNECT_ADDRESS: '10.93.0.1:5432',
      RESTAPI_CONNECT_ADDRESS: '10.93.0.1:8008',
    });
    expect(postgresSpec({ ...ctx, address: 'fd00::1' }, role).env).toMatchObject({
      PG_CONNECT_ADDRESS: '[fd00::1]:5432',
      RESTAPI_CONNECT_ADDRESS: '[fd00::1]:8008',
    });
    // Bootstrapping on loopback: nothing other members could use; Spilo's default until the overlay is there.
    const bootstrap = postgresSpec({ ...ctx, address: '127.0.0.1' }, role);

    expect(bootstrap.env).not.toHaveProperty('PG_CONNECT_ADDRESS');
    expect(bootstrap.env).not.toHaveProperty('RESTAPI_CONNECT_ADDRESS');
    // Not in the hash: a running Spilo gets them in place (no re-create after bootstrap or on the rollout).
    expect(bootstrap.hash).toBe(postgresSpec(ctx, role).hash);
  });

  it('keeps the Postgres spec (no restart) when members join or leave', () => {
    const grown = { ...role, members: [...role.members, { name: 'n7', address: '10.93.0.7', witness: false }] };
    const shrunk = { ...role, members: role.members.slice(0, 1) };

    expect(postgresSpec(ctx, grown).hash).toBe(postgresSpec(ctx, role).hash);
    expect(postgresSpec(ctx, shrunk).hash).toBe(postgresSpec(ctx, role).hash);
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

  it('hashes the API the same whichever replica sent the environment, in whatever order (live 3.43)', () => {
    const environment = { ...role.environment, DB_HOST: 'postgres', EMAIL_FROM: 'a@b.c' };
    const reversed = Object.fromEntries(Object.entries(environment).reverse());

    expect(controlPlaneApiSpec(ctx, { ...role, environment: reversed }).hash).toBe(
      controlPlaneApiSpec(ctx, { ...role, environment }).hash,
    );
  });

  it('never hosts the built-in control-plane member on a member node (3.39), whatever the environment says', () => {
    const forced = { ...role, environment: { ...role.environment, LOADWEAVER_BUILTIN_MEMBER: 'always' } };

    expect(controlPlaneApiSpec(ctx, role).env['LOADWEAVER_BUILTIN_MEMBER']).toBe('off');
    expect(controlPlaneApiSpec(ctx, forced).env['LOADWEAVER_BUILTIN_MEMBER']).toBe('off');
  });

  it('marks the API as running on a member, so it never starts a database handover (3.43)', () => {
    const forced = { ...role, environment: { ...role.environment, LOADWEAVER_CONTROL_PLANE_ON_MEMBER: 'false' } };

    expect(controlPlaneApiSpec(ctx, forced).env['LOADWEAVER_CONTROL_PLANE_ON_MEMBER']).toBe('true');
  });

  it('protects the member queue with its password and hands it to the API', () => {
    const withPassword = { ...ctx, queuePassword: 'q-secret' };

    expect(queueSpec(withPassword).cmd).toEqual(
      expect.arrayContaining(['--bind', '127.0.0.1', '--requirepass', 'q-secret']),
    );
    expect(controlPlaneApiSpec(withPassword, role).env).toMatchObject({
      CACHE_CLIENT: 'glide',
      VALKEY_HOST: '127.0.0.1',
      VALKEY_PORT: '6391',
      VALKEY_PASSWORD: 'q-secret',
    });
    expect(controlPlaneApiSpec(withPassword, role).env).not.toHaveProperty('REDIS_PASSWORD');
    expect(controlPlaneApiSpec(ctx, role).env['VALKEY_PASSWORD']).toBeUndefined();
  });

  it('hands the replicated email settings to the API only, and re-creates it when they change', () => {
    const smtp = { SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_PASSWORD: 'smtp-pw', EMAIL_FROM: 'a@b.c' };
    const withSmtp = { ...role, environment: { ...role.environment, ...smtp } };

    expect(controlPlaneApiSpec(ctx, withSmtp).env).toMatchObject(smtp);
    expect(controlPlaneApiSpec(ctx, withSmtp).hash).not.toBe(controlPlaneApiSpec(ctx, role).hash);
    expect(postgresSpec(ctx, withSmtp).env).not.toHaveProperty('SMTP_PASSWORD');
    expect(postgresSpec(ctx, withSmtp).hash).toBe(postgresSpec(ctx, role).hash);
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
