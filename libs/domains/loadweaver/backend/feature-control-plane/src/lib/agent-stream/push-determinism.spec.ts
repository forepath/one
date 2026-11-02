import type { DesiredState } from '@forepath/loadweaver/shared/util-agent-protocol';

import { platformBackupsRole } from '../backups/platform/platform-backups.role';
import { postgresRolePasswords } from '../database-handover/database-handover.utils';
import { memberEnvironment, withPushSecrets } from './agent-stream.server';

/**
 * Every control-plane replica must push the same role to a member: the member's agent re-creates Postgres and the API
 * whenever their rendered spec changes, so two replicas rendering differently make a member flip between two
 * container versions on every reconnect (found in the DR drill: Postgres + API restarted, quorum lost).
 */
describe('desired state pushed by different control-plane replicas', () => {
  const key = 'k'.repeat(43);
  const shared = {
    ENCRYPTION_KEY: key,
    DB_USERNAME: 'postgres',
    DB_PASSWORD: 'pw',
    JWT_SECRET: 'jwt',
    LOADWEAVER_CLUSTER_ID: 'lw-c',
    LOADWEAVER_POSTGRES_REPLICATION_PASSWORD: 'repl',
    LOADWEAVER_POSTGRES_ADMIN_PASSWORD: 'admin',
    LOADWEAVER_GRPC_ENDPOINTS: '203.0.113.1:7443',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    SMTP_USER: 'lw',
    SMTP_PASSWORD: 'smtp-pw',
    EMAIL_FROM: 'noreply@example.com',
  };
  // The bootstrap API on n1 and the API n2's agent rendered: each with its own overlay address appended.
  const replicaN1 = { ...shared, LOADWEAVER_GRPC_HOSTNAMES: 'localhost,127.0.0.1,203.0.113.1,10.93.0.1', PORT: '3400' };
  const replicaN2 = {
    ...shared,
    LOADWEAVER_GRPC_HOSTNAMES: 'localhost,127.0.0.1,203.0.113.1,10.93.0.1,10.93.0.2',
    VALKEY_PASSWORD: 'local-to-n2',
    REDIS_PASSWORD: 'legacy-local-to-n2',
  };
  const state = {
    revision: 7,
    controlPlane: {
      role: 'member',
      members: [
        { name: 'n1', address: '10.93.0.1', witness: false },
        { name: 'n2', address: '10.93.0.2', witness: false },
      ],
      automaticFailover: true,
      scope: 'lw-c',
      platformBackups: platformBackupsRole('n2', 'member', undefined, null, { ENCRYPTION_KEY: key }),
    },
    objectStore: {
      generations: [{ generation: 1, replicationFactor: 1, ports: { s3: 3900, rpc: 3901, admin: 3903 }, zone: 'a' }],
    },
  } as unknown as DesiredState;

  it('renders identical roles for a member, whichever replica pushes', () => {
    expect(withPushSecrets(state, replicaN2)).toEqual(withPushSecrets(state, replicaN1));
  });

  it("keeps operator host names but not the members' own addresses (each agent adds its own)", () => {
    expect(memberEnvironment(state, replicaN2)['LOADWEAVER_GRPC_HOSTNAMES']).toBe('localhost,127.0.0.1,203.0.113.1');
    expect(memberEnvironment(state, { LOADWEAVER_GRPC_HOSTNAMES: '10.93.0.1' })).not.toHaveProperty(
      'LOADWEAVER_GRPC_HOSTNAMES',
    );
    // Per-member settings never travel.
    expect(memberEnvironment(state, replicaN2)).not.toHaveProperty('VALKEY_PASSWORD');
    expect(memberEnvironment(state, replicaN2)).not.toHaveProperty('REDIS_PASSWORD');
  });

  it('pushes the shared email settings to every member', () => {
    expect(memberEnvironment(state, replicaN2)).toMatchObject({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_USER: 'lw',
      SMTP_PASSWORD: 'smtp-pw',
      EMAIL_FROM: 'noreply@example.com',
    });
  });

  it('derives unset Postgres role passwords at push time only, explicit values win (2026-10-30)', () => {
    const { LOADWEAVER_POSTGRES_REPLICATION_PASSWORD, LOADWEAVER_POSTGRES_ADMIN_PASSWORD, ...unset } = shared;
    const derived = postgresRolePasswords(key);

    expect([LOADWEAVER_POSTGRES_REPLICATION_PASSWORD, LOADWEAVER_POSTGRES_ADMIN_PASSWORD]).toEqual(['repl', 'admin']);
    expect(withPushSecrets(state, unset).controlPlane.environment).toMatchObject({
      LOADWEAVER_POSTGRES_REPLICATION_PASSWORD: derived.replication,
      LOADWEAVER_POSTGRES_ADMIN_PASSWORD: derived.admin,
    });
    expect(memberEnvironment(state, { ...unset, LOADWEAVER_POSTGRES_ADMIN_PASSWORD: 'explicit' })).toMatchObject({
      LOADWEAVER_POSTGRES_REPLICATION_PASSWORD: derived.replication,
      LOADWEAVER_POSTGRES_ADMIN_PASSWORD: 'explicit',
    });
    // The desired state as compiled / persisted never carries them.
    expect(state.controlPlane.environment).toBeUndefined();
    // Only members get the environment.
    const worker = { ...state, controlPlane: { ...state.controlPlane, role: 'none' } } as DesiredState;

    expect(withPushSecrets(worker, unset).controlPlane.environment).toBeUndefined();
  });
});
