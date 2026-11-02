import {
  drToolRequest,
  etcdRestoreArgs,
  postgresRestoreScript,
  recoveryIdentity,
  restoredEnvironment,
  restoreOptionsFrom,
  targetFromDrInfo,
  type DrInfoFile,
} from './dr-restore.utils';

const info: DrInfoFile = {
  format: 'loadweaver-dr-info',
  version: 1,
  clusterId: 'lw-c',
  targets: [
    { name: 'offsite', type: 's3', endpoint: 'https://s3.example', bucket: 'dr', region: 'eu-1', prefix: 'lw/' },
    {
      name: 'vault',
      type: 'sftp',
      host: 'sftp.example',
      port: 2222,
      user: 'bk',
      path: '/srv/bk',
      knownHosts: 'h ssh-ed25519 AAAA',
    },
  ],
};
const s3Env = { LOADWEAVER_DR_ACCESS_KEY_ID: 'AK', LOADWEAVER_DR_SECRET_ACCESS_KEY: 'SK' };

describe('bootstrap --restore (3.20)', () => {
  it('takes the target from the DR info file (first or by name)', () => {
    expect(targetFromDrInfo(info)).toMatchObject({ type: 's3', bucket: 'dr', prefix: 'lw/', region: 'eu-1' });
    expect(targetFromDrInfo(info, 'vault')).toMatchObject({ type: 'sftp', host: 'sftp.example', port: 2222 });
    expect(() => targetFromDrInfo(info, 'nope')).toThrow('no target nope');
    expect(() => targetFromDrInfo({ ...info, format: 'x' } as never)).toThrow('not a Loadweaver DR info');
  });

  it('validates the flags: node, host, target, credentials, key source, target time', () => {
    const files = { drInfo: JSON.stringify(info), shares: ['s1', 's2'] };
    const flags = { name: 'n1', 'public-host': 'n1.example', 'dr-info': 'dr.json' };

    expect(restoreOptionsFrom(flags, files, s3Env)).toMatchObject({
      nodeName: 'n1',
      publicHost: 'n1.example',
      target: { type: 's3', endpoint: 'https://s3.example' },
      credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
      key: { shares: ['s1', 's2'] },
      restoreVolumes: true,
    });
    // No shares and no KMS: asked for interactively (key null).
    expect(restoreOptionsFrom(flags, { ...files, shares: [] }, s3Env).key).toBeNull();
    expect(() => restoreOptionsFrom({ ...flags, name: 'N 1' }, files, s3Env)).toThrow('--name');
    expect(() => restoreOptionsFrom({ name: 'n1' }, files, s3Env)).toThrow('--public-host');
    expect(() => restoreOptionsFrom({ name: 'n1', 'public-host': 'h' }, { shares: [] }, s3Env)).toThrow(
      'name the external target',
    );
    expect(() => restoreOptionsFrom(flags, files, {})).toThrow('LOADWEAVER_DR_ACCESS_KEY_ID');
    expect(() => restoreOptionsFrom({ ...flags, kms: 'vault-transit' }, files, s3Env)).toThrow(
      'either --share-file or --kms',
    );
    expect(() => restoreOptionsFrom({ ...flags, 'target-time': 'yesterday' }, files, s3Env)).toThrow('ISO 8601');
    expect(
      restoreOptionsFrom(
        { ...flags, 'no-volume-restore': true, 'target-time': '2026-10-19T08:00:00+02:00' },
        files,
        s3Env,
      ),
    ).toMatchObject({ restoreVolumes: false, targetTime: '2026-10-19T06:00:00.000Z' });
  });

  it('takes S3 / SFTP targets from flags and the KMS settings from the environment', () => {
    expect(
      restoreOptionsFrom(
        { name: 'n1', 'public-host': 'h', 's3-endpoint': 'http://10.77.1.1:9000', 's3-bucket': 'lw-dr' },
        { shares: ['s'] },
        s3Env,
      ).target,
    ).toEqual({
      type: 's3',
      endpoint: 'http://10.77.1.1:9000',
      bucket: 'lw-dr',
      region: 'us-east-1',
      prefix: '',
      credentials: 'secret://dr-restore/s3',
    });
    expect(() =>
      restoreOptionsFrom(
        { name: 'n1', 'public-host': 'h', 's3-endpoint': 'ftp://x', 's3-bucket': 'b' },
        { shares: [] },
        s3Env,
      ),
    ).toThrow('http(s) URL');
    expect(() =>
      restoreOptionsFrom({ name: 'n1', 'public-host': 'h', 'sftp-host': 'x', 'sftp-user': 'u' }, { shares: [] }, {}),
    ).toThrow('--sftp-path');
    expect(
      restoreOptionsFrom(
        { name: 'n1', 'public-host': 'h', 'sftp-host': 'x', 'sftp-user': 'u', 'sftp-path': '/p' },
        { knownHosts: 'x ssh-ed25519 AAAA', sftpKey: 'KEY', shares: [] },
        {},
      ).credentials,
    ).toEqual({ privateKey: 'KEY' });
    expect(() =>
      restoreOptionsFrom(
        { name: 'n1', 'public-host': 'h', 'dr-info': 'f', kms: 'vault-transit' },
        { drInfo: JSON.stringify(info), shares: [] },
        s3Env,
      ),
    ).toThrow('VAULT_ADDR and VAULT_TOKEN');
    expect(
      restoreOptionsFrom(
        { name: 'n1', 'public-host': 'h', 'dr-info': 'f', kms: 'vault-transit' },
        { drInfo: JSON.stringify(info), shares: [] },
        { ...s3Env, VAULT_ADDR: 'https://vault', VAULT_TOKEN: 't', UNRELATED: 'x' },
      ).key,
    ).toEqual({ kms: { provider: 'vault-transit', env: { VAULT_ADDR: 'https://vault', VAULT_TOKEN: 't' } } });
  });

  it('builds the DR tool request and the restored environment (one-time recovery settings)', () => {
    const options = restoreOptionsFrom(
      { name: 'n1', 'public-host': 'n1.example', 'dr-info': 'f' },
      { drInfo: JSON.stringify(info), shares: ['a', 'b'] },
      s3Env,
    );

    expect(drToolRequest({ ...options, key: { shares: ['a', 'b'] } }, '/dr')).toEqual({
      target: options.target,
      credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
      key: { shares: ['a', 'b'] },
      outputDir: '/dr',
    });

    const recovery = recoveryIdentity(`lwj_${'a'.repeat(12)}.${'b'.repeat(43)}`);
    const env = restoredEnvironment(
      { clusterId: 'lw-c', env: { ENCRYPTION_KEY: 'k', DB_PASSWORD: 'p', LOADWEAVER_GRPC_HOSTNAMES: 'old' } },
      { ...options, key: { shares: [] } },
      recovery,
    );

    expect(env).toMatchObject({
      ENCRYPTION_KEY: 'k',
      DB_PASSWORD: 'p',
      DB_USERNAME: 'postgres',
      DB_DATABASE: 'postgres',
      AUTHENTICATION_METHOD: 'users',
      LOADWEAVER_CLUSTER_ID: 'lw-c',
      LOADWEAVER_GRPC_HOSTNAMES: 'localhost,127.0.0.1,n1.example',
      LOADWEAVER_GRPC_ENDPOINTS: 'n1.example:7443',
    });
    expect(JSON.parse(env['LOADWEAVER_DR_RECOVERY'])).toEqual({
      id: recovery.id,
      node: 'n1',
      token: recovery.token,
      secret: recovery.secret,
      restoreVolumes: true,
    });
    expect(recovery.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('restores Postgres with WAL-G from the decrypted copy, to the end or a target time', () => {
    const script = postgresRestoreScript({
      walgPrefix: 'platform/spilo/lw-c/wal/17',
      backup: 'base_000000010000000000000004',
    });

    expect(script).toContain('WALG_FILE_PREFIX=/dr/platform/spilo/lw-c/wal/17');
    expect(script).toContain('wal-g backup-fetch "$DATA" base_000000010000000000000004');
    expect(script).toContain('-c ssl=off -c archive_mode=off');
    expect(script).not.toContain('recovery_target_time');
    expect(
      postgresRestoreScript({
        walgPrefix: 'platform/spilo/lw-c/wal/17',
        backup: 'base_000000010000000000000004',
        targetTime: '2026-10-19T06:00:00Z',
      }),
    ).toContain("recovery_target_time='2026-10-19 06:00:00.000+00:00' -c recovery_target_action=promote");
    expect(() => postgresRestoreScript({ walgPrefix: '../x', backup: 'base_000000010000000000000004' })).toThrow(
      'unsafe',
    );
    expect(() => postgresRestoreScript({ walgPrefix: 'p', backup: 'base_1; rm -rf /' })).toThrow('invalid base backup');
  });

  it('restores etcd with this node as the only member', () => {
    expect(
      etcdRestoreArgs({ snapshot: '/dr/s.db', node: 'n1', clusterId: 'lw-c', dataDir: '/state/etcd-restore' }),
    ).toEqual([
      'etcdutl',
      'snapshot',
      'restore',
      '/dr/s.db',
      '--data-dir',
      '/state/etcd-restore',
      '--name',
      'n1',
      '--initial-cluster',
      'n1=http://127.0.0.1:2380',
      '--initial-advertise-peer-urls',
      'http://127.0.0.1:2380',
      '--initial-cluster-token',
      'lw-c',
    ]);
  });
});
