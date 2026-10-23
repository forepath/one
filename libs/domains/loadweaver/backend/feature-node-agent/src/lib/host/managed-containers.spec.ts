import { ManagedContainers } from './managed-containers';

/** A Docker stub with one running platform container whose spec hash is outdated. */
function dockerWith(options: { pullFails: boolean }) {
  const events: string[] = [];
  const docker = {
    getContainer: () => ({
      inspect: async () => ({
        Config: {
          Labels: {
            'loadweaver.com/managed': 'true',
            'loadweaver.com/spec-hash': 'old',
            'loadweaver.com/env-keys': '',
          },
          Env: [],
          Cmd: [],
        },
        State: { Running: true },
      }),
      remove: async () => void events.push('remove'),
      stop: async () => void events.push('stop'),
    }),
    listImages: async () => [],
    pull: async (image: string) => {
      events.push(`pull ${image}`);

      if (options.pullFails) throw new Error('error from registry: denied');

      return {};
    },
    modem: { followProgress: (_stream: unknown, done: (error: Error | null) => void) => done(null) },
    createContainer: async () => {
      events.push('create');

      return { start: async () => void events.push('start') };
    },
  };

  return { docker, events };
}

const spec = {
  name: 'lw-control-plane',
  image: `ghcr.io/forepath/loadweaver-control-plane-api:1.0.0@sha256:${'c'.repeat(64)}`,
  env: {},
  binds: [],
  memoryBytes: 1,
  hash: 'new',
  component: 'control-plane',
};

describe('ManagedContainers.ensure', () => {
  it('keeps the running container when the new image cannot be pulled (P gate: Cloud VM lab)', async () => {
    const { docker, events } = dockerWith({ pullFails: true });

    await expect(new ManagedContainers(docker as never).ensure(spec)).rejects.toThrow('denied');
    expect(events).toEqual([`pull ${spec.image}`]);
  });

  it('pulls the new image before it replaces the running container', async () => {
    const { docker, events } = dockerWith({ pullFails: false });

    expect(await new ManagedContainers(docker as never).ensure(spec)).toBe(true);
    expect(events.indexOf(`pull ${spec.image}`)).toBeLessThan(events.indexOf('remove'));
    expect(events.slice(-2)).toEqual(['create', 'start']);
  });
});
