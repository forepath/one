import { logStoreApiEnvironment, logStoreSpec } from '../control-plane/log-store';
import { LogCollectorsService } from './log-collectors.service';
import {
  birdSessions,
  handshakes,
  levelOf,
  parseEgressDecision,
  parseKernelRecord,
  redact,
  workloadLabels,
} from './log-parsing';
import { LogShipper, MAX_QUEUED } from './log-shipper';

const line = (message: string) => ({
  at: '2026-10-18T10:00:00.000Z',
  source: 'container' as const,
  level: 'info' as const,
  message,
  labels: {},
});

describe('log collection on the node (3.14)', () => {
  it('parses firewall records from the kernel log', () => {
    expect(
      parseKernelRecord(
        '[    5.000000] lwdeny IN=lw-0a1b2c3d OUT=lwbr0 SRC=10.42.1.10 DST=10.42.2.10 LEN=60 PROTO=TCP SPT=40000 DPT=5432 SYN',
      ),
    ).toEqual({
      decision: 'denied',
      fields: {
        in: 'lw-0a1b2c3d',
        out: 'lwbr0',
        src: '10.42.1.10',
        dst: '10.42.2.10',
        len: '60',
        proto: 'TCP',
        spt: '40000',
        dpt: '5432',
      },
    });
    expect(
      parseKernelRecord('<4>lwobs 0123456789ab IN=lwbr0 SRC=10.42.1.10 DST=1.1.1.1 PROTO=UDP DPT=53'),
    ).toMatchObject({
      decision: 'observed',
      tag: '0123456789ab',
    });
    expect(parseKernelRecord('[ 1.0] some other kernel message')).toBeNull();
  });

  it('labels workload lines, picks levels and redacts delivered secrets', () => {
    expect(workloadLabels('shop/site/web/0')).toEqual({
      project: 'shop',
      deployment: 'site',
      service: 'web',
      replica: 'shop/site/web/0',
    });
    expect(workloadLabels(undefined)).toEqual({});
    expect(levelOf('{"level":"error","msg":"x"}', 'stdout')).toBe('error');
    expect(levelOf('plain', 'stderr')).toBe('warn');
    expect(redact('connecting with s3cr3t-pw and s3cr3t-pw', ['s3cr3t-pw', 'abc'])).toBe(
      'connecting with [redacted] and [redacted]',
    );
  });

  it('reads tunnel handshakes and BGP sessions', () => {
    expect(
      handshakes(
        'lw-a\tPRIV\tPUB\t51820\toff\nlw-a\tPEER\t(none)\t1.2.3.4:51820\t10.0.0.2/32\t1700000000\t1\t2\toff',
      ).get('lw-a/PEER'),
    ).toEqual({
      iface: 'lw-a',
      peer: 'PEER',
      handshake: 1700000000,
    });
    expect(
      birdSessions(
        'Name       Proto      Table      State  Since         Info\nn2_4       BGP        ---        up     10:00:00.000  Established\nlw_links4  Static     master4    up     10:00:00.000',
      ),
    ).toEqual(new Map([['n2_4', 'Established']]));
  });

  it('ships one confirmed batch at a time, keeps unconfirmed ones, and drops the oldest when full', () => {
    const shipper = new LogShipper();
    const sent: { id: string; payload: Uint8Array }[] = [];
    let connected = false;
    const decode = (i: number) =>
      JSON.parse(Buffer.from(sent[i].payload).toString('utf8')) as { entries: { message: string }[]; dropped?: number };

    shipper.attach((envelope) => {
      if (!connected) return false;

      sent.push(envelope as never);

      return true;
    });

    for (let i = 0; i < 600; i++) shipper.push(line(`l${i}`));

    shipper.push({ ...line('bad'), at: 'not a date' });
    shipper.flush(1_000);
    expect(sent).toHaveLength(0);

    connected = true;
    shipper.flush(1_000);
    // One batch in flight, nothing more until it is confirmed.
    shipper.flush(2_000);
    expect(sent).toHaveLength(1);
    expect(decode(0).entries.map((e) => e.message)).toEqual(Array.from({ length: 500 }, (_, i) => `l${i}`));
    // The malformed line was counted as dropped, not sent.
    expect(decode(0).dropped).toBe(1);

    // The log store was down: the batch stays and is sent again after a pause.
    shipper.ack(sent[0].id, false, 3_000);
    shipper.flush(4_000);
    expect(sent).toHaveLength(1);
    shipper.flush(9_000);
    expect(sent).toHaveLength(2);
    expect(decode(1).entries).toHaveLength(500);

    // Stored: the next batch follows right away; an unanswered batch is resent after the timeout.
    shipper.ack(sent[1].id, true, 9_500);
    expect(sent).toHaveLength(3);
    expect(decode(2).entries.map((e) => e.message)).toEqual(Array.from({ length: 100 }, (_, i) => `l${i + 500}`));
    expect(decode(2).dropped).toBeUndefined();
    shipper.flush(50_000);
    expect(sent).toHaveLength(4);
    shipper.ack(sent[3].id, true, 50_001);
    expect(shipper.queued()).toBe(0);

    connected = false;

    for (let i = 0; i < MAX_QUEUED + 10; i++) shipper.push(line('x'));

    expect(shipper.queued()).toBe(MAX_QUEUED);
    shipper.onModuleDestroy();
  });

  it('reports tunnel and BGP changes, not steady state', async () => {
    let dump = 'lw-a\tPEER\t(none)\t1.2.3.4:51820\t10.0.0.2/32\t1000\t1\t2\toff';
    let protocols = 'n2_4 BGP --- up 10:00 Established';
    const commands = {
      run: jest.fn(async (cmd: string) => ({ stdout: cmd === 'wg' ? dump : protocols, stderr: '' })),
    };
    const shipper = new LogShipper();
    const pushed: { message: string; source: string }[] = [];

    jest.spyOn(shipper, 'push').mockImplementation((e) => void pushed.push(e));

    const collectors = new LogCollectorsService({} as never, commands as never, shipper, {} as never);

    await collectors.pollTunnels(1100);
    await collectors.pollRouting();
    expect(pushed).toEqual([]);

    dump = dump.replace('\t1000\t', '\t1000\t');
    protocols = 'n2_4 BGP --- start 10:01 Active';
    await collectors.pollTunnels(1500);
    await collectors.pollRouting();
    expect(pushed.map((p) => [p.source, p.message])).toEqual([
      ['tunnel', 'WireGuard peer on lw-a down (no handshake for 3 minutes)'],
      ['routing', 'BGP session n2_4: Established → Active'],
    ]);
  });

  it('renders the log store for one and for several members', () => {
    const role = {
      role: 'member' as const,
      members: [{ name: 'n1', address: '10.44.0.1', witness: false }],
      automaticFailover: false,
      scope: 'c1',
      logStore: { clusterName: 'c1', heapMb: 512, httpPort: 9200, transportPort: 9300 },
    };
    const single = logStoreSpec('n1', '10.44.0.1', role, '/var/lib/loadweaver/opensearch', 'img');

    expect(single.env).toMatchObject({
      'discovery.type': 'single-node',
      'network.bind_host': '10.44.0.1,127.0.0.1',
      DISABLE_SECURITY_PLUGIN: 'true',
    });
    expect(single.memoryBytes).toBe(1024 ** 3);

    const three = logStoreSpec(
      'n2',
      '10.44.0.2',
      {
        ...role,
        members: [
          { name: 'n1', address: '10.44.0.1', witness: false },
          { name: 'n2', address: '10.44.0.2', witness: false },
          { name: 'n3', address: '10.44.0.3', witness: false },
          { name: 'w', address: '10.44.0.9', witness: true },
        ],
      },
      '/d',
      'img',
    );

    expect(three.env['discovery.seed_hosts']).toBe('10.44.0.1:9300,10.44.0.3:9300');
    expect(three.env['cluster.initial_cluster_manager_nodes']).toBe('n1,n2,n3');
    expect(three.env['discovery.type']).toBeUndefined();
    expect(logStoreApiEnvironment('10.44.0.2', role)).toEqual({
      OPENSEARCH_ENABLED: 'true',
      OPENSEARCH_NODE: 'http://10.44.0.2:9200',
      OPENSEARCH_INDEX_PREFIX: 'loadweaver',
    });
    expect(logStoreApiEnvironment('10.44.0.2', { ...role, logStore: undefined })).toEqual({
      OPENSEARCH_ENABLED: 'false',
    });
  });
});

describe('egress decisions from the node proxy (3.7 / 3.14)', () => {
  const line = (extra: Record<string, string>) =>
    JSON.stringify({ kind: 'egress-http', source: '10.42.1.10', host: 'evil.example', status: '403', ...extra });

  it('reports enforced denials as blocked with the rule', () => {
    expect(
      parseEgressDecision(
        line({ rule: 'r2_deny_host', details: 'rbac_access_denied_matched_policy[r2_deny_host]', mode: 'enforce' }),
      ),
    ).toEqual({
      source: '10.42.1.10',
      kind: 'web',
      decision: 'blocked',
      rule: 'deny_host',
      host: 'evil.example',
      status: 403,
    });
  });

  it('reports allow-list misses and shadow matches', () => {
    expect(
      parseEgressDecision(line({ rule: '-', allow: 'denied', details: 'rbac_access_denied_matched_policy[none]' })),
    ).toMatchObject({ decision: 'blocked', rule: 'not_allowlisted' });
    expect(parseEgressDecision(line({ rule: 'r5_deny_url', mode: 'monitor', details: 'via_upstream' }))).toMatchObject({
      decision: 'observed',
      rule: 'deny_url',
    });
    expect(parseEgressDecision(line({ rule: '-', mode: 'monitor', shadow: 'denied' }))).toMatchObject({
      decision: 'observed',
      rule: 'not_allowlisted',
    });
    expect(parseEgressDecision(line({ rule: '-', allow: 'allowed', details: 'via_upstream' }))).toMatchObject({
      decision: 'allowed',
      rule: null,
    });
  });

  it('ignores other lines', () => {
    expect(parseEgressDecision('{"kind":"ingress-http"}')).toBeNull();
    expect(parseEgressDecision('plain text')).toBeNull();
  });
});
