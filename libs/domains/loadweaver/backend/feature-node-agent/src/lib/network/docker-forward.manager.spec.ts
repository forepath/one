import { DockerForwardManager } from './docker-forward.manager';

describe('DockerForwardManager', () => {
  it('inserts the pod bridge accepts once, per family that has a DOCKER-USER chain', async () => {
    const calls: string[] = [];
    const present = new Set<string>();
    const commands = {
      run: jest.fn(async (tool: string, args: string[]) => {
        const line = `${tool} ${args.join(' ')}`;

        calls.push(line);

        if (tool === 'ip6tables' && args.includes('-L')) throw new Error('no chain');

        if (args.includes('-C') && !present.has(`${tool} ${args.slice(args.indexOf('DOCKER-USER') + 1).join(' ')}`))
          throw new Error('missing');

        if (args.includes('-I')) present.add(`${tool} ${args.slice(args.indexOf('DOCKER-USER') + 2).join(' ')}`);

        return { stdout: '', stderr: '' };
      }),
    };
    const manager = new DockerForwardManager(commands as never);

    expect(await manager.apply()).toBe(true);
    expect(calls.filter((c) => c.includes(' -I '))).toEqual([
      'iptables -w -t filter -I DOCKER-USER 1 -i lwbr0 -j ACCEPT -m comment --comment loadweaver: policies in table inet loadweaver',
      'iptables -w -t filter -I DOCKER-USER 1 -o lwbr0 -j ACCEPT -m comment --comment loadweaver: policies in table inet loadweaver',
    ]);
    expect(await manager.apply()).toBe(false);
  });
});
