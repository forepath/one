import { PassThrough } from 'node:stream';

import { endAfterWorkloadExit, portWriter } from './port-attachment';

describe('endAfterWorkloadExit (guest agent end after the workload exited)', () => {
  it('stops reading the port, flushes, then kills itself once (never process.exit: libuv joins the blocked reader)', () => {
    const calls: string[] = [];
    let flushed: () => void = () => undefined;
    let timer: () => void = () => undefined;

    endAfterWorkloadExit({
      stopReading: () => calls.push('stop reading'),
      flush: (done) => {
        calls.push('flush');
        flushed = done;
      },
      kill: () => calls.push('kill'),
      setTimer: (run, ms) => {
        calls.push(`timer ${ms}`);
        timer = run;
      },
    });

    expect(calls).toEqual(['stop reading', 'flush', 'timer 2000']);
    flushed();
    timer();
    expect(calls).toEqual(['stop reading', 'flush', 'timer 2000', 'kill']);
  });

  it('kills itself after 2 s when the flush never completes', () => {
    const kill = jest.fn();
    let timer: () => void = () => undefined;

    endAfterWorkloadExit({
      stopReading: () => undefined,
      flush: () => undefined,
      kill,
      setTimer: (run) => {
        timer = run;
      },
    });
    expect(kill).not.toHaveBeenCalled();
    timer();
    expect(kill).toHaveBeenCalledTimes(1);
  });
});

describe('portWriter (guest writes to the bridge port)', () => {
  it('drops frames after the port stream ended instead of crashing on "write after end", and logs stream errors', async () => {
    const output = new PassThrough();
    const received: Buffer[] = [];
    const logs: string[] = [];

    output.on('data', (chunk: Buffer) => received.push(chunk));

    const write = portWriter(output, (message) => logs.push(message));

    write(Buffer.from('workload-exit'));
    await new Promise<void>((resolve) => output.end(resolve));
    // A killed exec session reports its exit after the end: dropped, no 'error' event, nothing thrown.
    expect(() => write(Buffer.from('exec-exit'))).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));

    expect(Buffer.concat(received).toString()).toBe('workload-exit');
    expect(logs).toEqual([]);

    // A port that fails while open: logged, not thrown as an unhandled 'error'.
    const failing = new PassThrough();

    portWriter(failing, (message) => logs.push(message));
    failing.destroy(new Error('port gone'));
    await new Promise((resolve) => setImmediate(resolve));
    expect(logs).toEqual(['bridge port write: port gone']);
  });
});
