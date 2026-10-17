import { decodeAgentMessage, type Envelope } from '@forepath/loadweaver/shared/util-agent-protocol';
import Docker from 'dockerode';

import { LiveSessionsService, NODE_SHELL_IMAGE, NODE_SHELL_LABEL } from '../lib/live/live-sessions.service';
import { WORKLOAD_LABEL } from '../lib/workloads/workload-container';

/**
 * Terminals on real Docker (3.19): `docker exec` with a TTY into a replica (input, output, resize, exit code) and the
 * host shell through the pinned nsenter helper — only while the cluster enables it.
 */
describe('live terminals (lab)', () => {
  const docker = new Docker();
  const name = `lw-live-lab-${process.pid}-${Date.now()}`;
  const replica = 'shop/site/web/0';
  const sent: Envelope[] = [];
  let live: LiveSessionsService;

  const messages = (channel: string) =>
    sent
      .filter((e) => e.channel === channel)
      .map((e) => decodeAgentMessage(e))
      .flatMap((d) => (d.ok ? [d.message] : []));
  const output = (channel: string) =>
    messages(channel)
      .filter((m) => m.type === 'execOutput')
      .map((m) => Buffer.from((m.payload as { data: string }).data, 'base64').toString())
      .join('');
  const exited = async (channel: string) => {
    for (let i = 0; i < 300; i++) {
      const exit = messages(channel).find((m) => m.type === 'execExit');

      if (exit) return exit.payload as { code: number | null; error?: string };

      await new Promise((r) => setTimeout(r, 100));
    }

    throw new Error(`no exit on ${channel}: ${output(channel)}`);
  };

  beforeAll(async () => {
    for (const image of [NODE_SHELL_IMAGE])
      await new Promise<void>((resolve, reject) =>
        docker.pull(image, (error: Error | null, stream: NodeJS.ReadableStream) =>
          error ? reject(error) : docker.modem.followProgress(stream, (e) => (e ? reject(e) : resolve())),
        ),
      );

    const container = await docker.createContainer({
      name,
      Image: NODE_SHELL_IMAGE,
      Cmd: ['sleep', '300'],
      Labels: { [WORKLOAD_LABEL]: replica },
      HostConfig: { Memory: 128 * 1024 ** 2 },
    });

    await container.start();
    live = new LiveSessionsService(docker, { mountedPath: async () => null } as never);
    live.attach((envelope) => sent.push(envelope));
  }, 180_000);

  afterAll(async () => {
    await live?.onModuleDestroy();
    await docker
      .getContainer(name)
      .remove({ force: true })
      .catch(() => undefined);
  });

  it('runs a shell in a replica with a TTY: input, output, resize and the exit code', async () => {
    await live.openTerminal('t1', { target: { kind: 'replica', replica }, command: ['/bin/sh'], cols: 80, rows: 24 });
    await live.resize('t1', 120, 40);
    live.input('t1', Buffer.from('stty size; echo $((6*7)); exit 3\n').toString('base64'));

    expect(await exited('t1')).toEqual({ code: 3 });
    expect(output('t1')).toContain('40 120');
    expect(output('t1')).toContain('42');
  }, 60_000);

  it('reports replicas that are not here and refuses host shells unless enabled', async () => {
    await live.openTerminal('t2', { target: { kind: 'replica', replica: 'shop/site/web/9' }, cols: 80, rows: 24 });
    expect((await exited('t2')).error).toContain("doesn't run on this node");

    await live.openTerminal('t3', { target: { kind: 'node' }, cols: 80, rows: 24 });
    expect((await exited('t3')).error).toBe('node shells are disabled for this cluster');
  }, 60_000);

  it('opens a host shell through the nsenter helper when the cluster allows it, and removes the helper', async () => {
    live.configure({ nodeShell: true });
    await live.openTerminal('t4', {
      target: { kind: 'node' },
      command: ['/bin/sh', '-c', 'echo pid1=$(cat /proc/1/comm)'],
      cols: 80,
      rows: 24,
    });

    expect((await exited('t4')).code).toBe(0);
    expect(output('t4')).toMatch(/pid1=\S+/);
    expect(await docker.listContainers({ all: true, filters: { label: ['loadweaver.com/node-shell=true'] } })).toEqual(
      [],
    );
  }, 60_000);

  it('ends host shells and removes their helpers when the stream drops, and leftovers at start', async () => {
    const helpers = async () =>
      await docker.listContainers({ all: true, filters: { label: [`${NODE_SHELL_LABEL}=true`] } });

    live.configure({ nodeShell: true });
    await live.openTerminal('t5', {
      target: { kind: 'node' },
      command: ['/bin/sh', '-c', 'sleep 300'],
      cols: 80,
      rows: 24,
    });
    expect(await helpers()).toHaveLength(1);
    await live.closeAll();
    expect((await exited('t5')).code).not.toBe(0);
    expect(await helpers()).toEqual([]);

    // A helper left behind by a previous agent process.
    const leftover = await docker.createContainer({
      Image: NODE_SHELL_IMAGE,
      Cmd: ['sleep', '300'],
      Labels: { [NODE_SHELL_LABEL]: 'true' },
      HostConfig: { Memory: 128 * 1024 ** 2 },
    });

    await leftover.start();
    await live.reset();
    expect(await helpers()).toEqual([]);
  }, 60_000);
});
