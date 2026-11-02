import { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { MICROVM_GUEST_OOM_SCORE_ADJ_PATH } from './constants';
import { Frame, FrameDecoder, FrameType, decodeJson, encodeFrame, encodeJson } from './frame';
import { GuestAgent } from './guest-agent';
import { CONTROL_STREAM } from './host-daemon';

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly stdio: unknown[] = [this.stdin, this.stdout, this.stderr, new PassThrough()];
  readonly pid = 4242;
  exitCode: number | null = null;
}

interface Harness {
  agent: GuestAgent;
  frames: Frame[];
  /** Every write to the agent's oom_score_adj, in order. */
  oomWrites: string[];
  /** The agent's oom_score_adj at the moment each process was spawned (what the child inherits). */
  inherited: (string | undefined)[];
  children: FakeChild[];
  logs: string[];
  exits: number[];
  vmstat: string;
  send: (type: FrameType, stream: number, value: unknown) => void;
}

function harness(options: { failOomWrite?: boolean } = {}): Harness {
  const decoder = new FrameDecoder();
  const h: Harness = {
    agent: undefined as unknown as GuestAgent,
    frames: [],
    oomWrites: [],
    inherited: [],
    children: [],
    logs: [],
    exits: [],
    vmstat: 'pgfault 10\noom_kill 2\n',
    send: (type, stream, value) => h.agent.receive(encodeFrame(type, stream, encodeJson(value))),
  };

  h.agent = new GuestAgent({
    write: (bytes) => h.frames.push(...decoder.push(bytes)),
    readFile: (path) => {
      if (path === '/proc/vmstat') return h.vmstat;
      if (path === '/etc/passwd') return 'root:x:0:0:root:/root:/bin/sh\n';
      if (path === '/etc/group') return 'root:x:0:\n';

      throw new Error(`ENOENT ${path}`);
    },
    writeFile: (path, content) => {
      if (path !== MICROVM_GUEST_OOM_SCORE_ADJ_PATH) return;
      if (options.failOomWrite) throw new Error('EACCES');

      h.oomWrites.push(content);
    },
    spawn: () => {
      const child = new FakeChild();

      h.inherited.push(h.oomWrites[h.oomWrites.length - 1]);
      h.children.push(child);

      return child as unknown as ChildProcess;
    },
    ids: { uid: 0, gid: 0 },
    log: (message) => h.logs.push(message),
    onWorkloadExit: (code) => h.exits.push(code),
  });

  return h;
}

function boot(h: Harness): void {
  h.send(FrameType.Boot, CONTROL_STREAM, {
    argv: ['/app/server'],
    env: ['PATH=/usr/bin:/bin'],
    workdir: '/',
    user: '',
    hostname: 'web-0',
    hosts: '127.0.0.1 localhost\n',
    dnsSearch: '',
    dnsOptions: '',
    loopbackPorts: [],
  });
}

function workloadExits(h: Harness): unknown[] {
  return h.frames
    .filter((frame) => frame.stream === CONTROL_STREAM && frame.type === FrameType.WorkloadExit)
    .map((frame) => decodeJson(frame.payload));
}

describe('guest OOM priority (bridge agent survives, workload is the OOM victim)', () => {
  let h: Harness;

  afterEach(() => h.agent.stop());

  it('protects the agent with oom_score_adj -1000 when it starts', () => {
    h = harness();
    h.agent.start();

    expect(h.oomWrites).toEqual(['-1000']);
  });

  it('spawns the workload with oom_score_adj 0 and protects the agent again right after', () => {
    h = harness();
    h.agent.start();
    boot(h);

    expect(h.children).toHaveLength(1);
    expect(h.inherited).toEqual(['0']);
    expect(h.oomWrites).toEqual(['-1000', '0', '-1000']);
  });

  it('spawns exec processes with oom_score_adj 0', () => {
    h = harness();
    h.agent.start();
    boot(h);
    h.send(FrameType.OpenExec, 7, { argv: ['sh'], env: [], user: '', workdir: '', tty: false, cols: 80, rows: 24 });

    expect(h.inherited).toEqual(['0', '0']);
    expect(h.oomWrites).toEqual(['-1000', '0', '-1000', '0', '-1000']);
  });

  it('keeps the agent protected when the spawn throws', () => {
    h = harness();
    h.agent.start();
    jest.spyOn(h.agent as unknown as { spawn: () => never }, 'spawn').mockImplementation(() => {
      throw new Error('EAGAIN');
    });
    boot(h);

    expect(h.oomWrites).toEqual(['-1000', '0', '-1000']);
    expect(workloadExits(h)).toEqual([{ code: 127 }]);
  });

  it('reports 137 for a workload ended by the guest OOM killer and logs the kill', () => {
    h = harness();
    h.agent.start();
    boot(h);
    h.vmstat = 'pgfault 99\noom_kill 3\n';
    h.children[0].emit('close', null, 'SIGKILL');

    expect(workloadExits(h)).toEqual([{ code: 137 }]);
    expect(h.exits).toEqual([137]);
    expect(h.logs).toContain('guest OOM killer ended 1 process(es) while the workload ran (workload exit status 137)');
  });

  it('logs no OOM kill when the counter did not move', () => {
    h = harness();
    h.agent.start();
    boot(h);
    h.children[0].emit('close', 0, null);

    expect(workloadExits(h)).toEqual([{ code: 0 }]);
    expect(h.logs.filter((line) => line.includes('OOM'))).toEqual([]);
  });

  it('logs and spawns normally when oom_score_adj cannot be written', () => {
    h = harness({ failOomWrite: true });
    h.agent.start();
    boot(h);

    expect(h.children).toHaveLength(1);
    expect(h.logs).toEqual(['cannot set oom_score_adj -1000: EACCES']);
  });
});
