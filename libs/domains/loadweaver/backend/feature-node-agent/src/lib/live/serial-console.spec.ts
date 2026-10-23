import { Duplex, PassThrough } from 'node:stream';

import { SERIAL_RETRY_MS, SerialConsoles, SerialLog } from './serial-console';
import { VM_CONSOLE_PATH } from './guest-target';

/** Docker's stdio framing without a TTY: 8-byte header (stream, 0, 0, 0, length), then the payload. */
const frame = (kind: 1 | 2, data: string) => {
  const payload = Buffer.from(data);
  const header = Buffer.alloc(8);

  header[0] = kind;
  header.writeUInt32BE(payload.length, 4);

  return Buffer.concat([header, payload]);
};

const demuxStream = (source: Duplex, stdout: PassThrough, stderr: PassThrough) => {
  let buffer = Buffer.alloc(0);

  source.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 8 && buffer.length >= 8 + buffer.readUInt32BE(4)) {
      const length = buffer.readUInt32BE(4);

      (buffer[0] === 2 ? stderr : stdout).write(buffer.subarray(8, 8 + length));
      buffer = buffer.subarray(8 + length);
    }
  });
};

const tick = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

describe('serial log ring', () => {
  it('keeps the last bytes only', () => {
    const log = new SerialLog(8);

    log.append(Buffer.from('abc'));
    log.append(Buffer.from('defg'));
    expect(log.snapshot().toString()).toBe('abcdefg');
    log.append(Buffer.from('hij'));
    expect(log.snapshot().toString()).toBe('cdefghij');
    expect(log.size).toBe(8);
    log.append(Buffer.from('0123456789'));
    expect(log.snapshot().toString()).toBe('23456789');
  });
});

describe('serial consoles', () => {
  const setup = () => {
    const streams: Duplex[] = [];
    const written: Buffer[] = [];
    const execs: Record<string, unknown>[] = [];
    let running = true;
    const events = new PassThrough();
    const docker = {
      modem: { demuxStream },
      getEvents: async () => events,
      listContainers: async () => [{ Id: 'vm-c1', Labels: { 'loadweaver.com/workload': 'shop/lw-vm/db1/0' } }],
      getContainer: () => ({
        exec: async (options: Record<string, unknown>) => {
          execs.push(options);

          return {
            start: async () => {
              const stream = new Duplex({
                read: () => undefined,
                write: (chunk: Buffer, _encoding, done) => (written.push(chunk), done()),
              });

              streams.push(stream);

              return stream;
            },
          };
        },
        inspect: async () => ({ State: { Running: running } }),
      }),
    } as never;

    return {
      serial: new SerialConsoles(docker),
      streams,
      written,
      execs,
      events,
      stop: () => (running = false),
    };
  };

  afterEach(() => jest.useRealTimers());

  it('collects from the start of a running VM, replays the boot log to viewers and fans out input / output', async () => {
    const { serial, streams, written, execs } = setup();

    await serial.watch();
    await tick();
    expect(execs).toEqual([
      { Cmd: [VM_CONSOLE_PATH, 'serial'], AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: false },
    ]);

    streams[0].push(frame(1, 'BdsDxe: loading Boot0001\r\n'));
    streams[0].push(frame(2, 'vm-console: noise\n'));
    await tick();
    expect(serial.logOf('vm-c1')?.toString()).toBe('BdsDxe: loading Boot0001\r\n');

    const seen: string[] = [];
    const detach = serial.view('vm-c1', 'shop/lw-vm/db1/0', {
      output: (chunk) => seen.push(chunk.toString()),
      ended: () => undefined,
    });

    expect(seen).toEqual(['BdsDxe: loading Boot0001\r\n']);
    streams[0].push(frame(1, 'login: '));
    await tick();
    expect(seen.at(-1)).toBe('login: ');
    expect(serial.input('vm-c1', Buffer.from('root\r'))).toBe(true);
    expect(Buffer.concat(written).toString()).toBe('root\r');

    detach();
    streams[0].push(frame(1, 'Password: '));
    await tick();
    expect(seen.at(-1)).toBe('login: ');
    expect(serial.logOf('vm-c1')?.toString()).toContain('Password: ');
    serial.stop();
  });

  it('re-attaches while the VM boots and ends its viewers when the VM stops', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });

    const { serial, streams, events, stop } = setup();
    const ended: string[] = [];

    await serial.watch();
    await tick();
    serial.view('vm-c1', 'shop/lw-vm/db1/0', { output: () => undefined, ended: (r) => ended.push(r) });
    // The relay found no console yet (the domain is starting): it ends, and is retried.
    streams[0].push(null);
    await tick();
    expect(streams).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(SERIAL_RETRY_MS);
    await tick();
    expect(streams).toHaveLength(2);
    expect(ended).toEqual([]);

    stop();
    events.write(`${JSON.stringify({ Action: 'die', Actor: { ID: 'vm-c1', Attributes: {} } })}\n`);
    await tick();
    expect(ended).toEqual(['the virtual machine stopped']);
    expect(serial.logOf('vm-c1')).toBeNull();
    serial.stop();
  });

  it('starts a collector when a VM container starts', async () => {
    const { serial, execs, events } = setup();

    await serial.watch();
    await tick();
    events.write(
      `${JSON.stringify({ Action: 'start', Actor: { ID: 'vm-c2', Attributes: { 'loadweaver.com/workload': 'shop/lw-vm/db2/0' } } })}\n`,
    );
    await tick();
    expect(execs).toHaveLength(2);
    expect(serial.logOf('vm-c2')).toEqual(Buffer.alloc(0));
    serial.stop();
  });
});
