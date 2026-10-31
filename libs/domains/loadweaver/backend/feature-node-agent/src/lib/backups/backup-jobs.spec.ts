import { BackupJobs } from './backup-jobs';

/** A Docker log frame (stdout). */
const frame = (text: string) => {
  const body = Buffer.from(text);
  const header = Buffer.alloc(8);

  header[0] = 1;
  header.writeUInt32BE(body.length, 4);

  return Buffer.concat([header, body]);
};

function setup() {
  let exit: ((value: { StatusCode: number }) => void) | undefined;
  const container = {
    start: jest.fn(async () => undefined),
    wait: jest.fn(() => new Promise<{ StatusCode: number }>((resolve) => (exit = resolve))),
    kill: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
    logs: jest.fn(async () => frame('    (40.00/100%)\r')),
  };
  const docker = {
    getContainer: jest.fn(() => ({ remove: jest.fn(async () => undefined) })),
    createContainer: jest.fn(async () => container),
  };
  const containers = { pull: jest.fn(async (image: string) => image) };
  const jobs = new BackupJobs(docker as never, containers as never);
  const spec = {
    name: 'lw-bk-img-1',
    image: 'launcher',
    cmd: ['convert'],
    binds: [],
    network: 'none' as const,
    timeoutMs: 60_000,
  };

  return { jobs, container, spec, exit: (code: number) => exit?.({ StatusCode: code }) };
}

describe('BackupJobs cancellation and progress (F3b)', () => {
  it('kills and removes the container when the signal aborts', async () => {
    const { jobs, container, spec } = setup();
    const controller = new AbortController();
    const run = jobs.run({ ...spec, signal: controller.signal });

    await new Promise((resolve) => setImmediate(resolve));
    controller.abort(new Error('cancelled: VM deleted'));
    await expect(run).rejects.toThrow('cancelled: VM deleted');
    expect(container.kill).toHaveBeenCalled();
    expect(container.remove).toHaveBeenCalledWith({ force: true });

    // Already aborted: never started.
    const started = setup();

    await expect(started.jobs.run({ ...started.spec, signal: controller.signal })).rejects.toThrow('cancelled');
    expect(started.container.start).not.toHaveBeenCalled();
  });

  it('hands the stdout so far to the progress reader while the job runs', async () => {
    jest.useFakeTimers();

    try {
      const { jobs, spec, exit } = setup();
      const seen: string[] = [];
      const run = jobs.run({ ...spec, progress: { intervalMs: 1000, stdout: (s) => seen.push(s) } });

      await jest.advanceTimersByTimeAsync(2500);
      expect(seen).toEqual(['    (40.00/100%)\r', '    (40.00/100%)\r']);
      exit(0);
      await expect(run).resolves.toMatchObject({ exitCode: 0 });
      await jest.advanceTimersByTimeAsync(5000);
      expect(seen).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
