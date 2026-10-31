import { criuVersionOf, HostInfoService } from './host-info.service';

describe('checkpoint capability (3.10)', () => {
  const host = (fails: string[], extra: Record<string, string> = {}) =>
    new HostInfoService({
      run: jest.fn(async (cmd: string, args: string[]) => {
        const line = `${cmd} ${args.join(' ')}`;

        if (fails.some((f) => line.startsWith(f))) throw new Error(`${line} failed`);

        return { stdout: extra[line] ?? '', stderr: '' };
      }),
      available: jest.fn(async (cmd: string) => !fails.includes(cmd)),
      json: jest.fn(async () => [{ dev: 'lwnosuchdev0' }]),
    } as never);

  it('reads the CRIU version', () => {
    expect(criuVersionOf('Version: 4.1.1\nGitID: v4.1.1\n')).toBe('4.1.1');
    expect(criuVersionOf('nothing')).toBeUndefined();
  });

  it('needs a passing `criu check` and runc for runc checkpoints', async () => {
    const ok = await host([], { 'criu --version': 'Version: 4.1.1\n' }).checkpoint({}, true);

    expect(ok).toEqual({ runc: true, runsc: false, criuVersion: '4.1.1' });
    expect(await host(['criu check']).checkpoint({}, true)).toMatchObject({ runc: false, runsc: false });
  });

  it('needs the gVisor sandbox runtime with its own network stack, a working runsc and cgroup v2 for runsc', async () => {
    const runtimes = { 'runsc-systrap': { path: '/usr/local/bin/runsc', runtimeArgs: ['--platform=systrap'] } };

    expect(await host(['criu check']).checkpoint(runtimes, true)).toMatchObject({ runc: false, runsc: true });
    expect(await host(['/usr/local/bin/runsc']).checkpoint(runtimes, true)).toMatchObject({ runsc: false });
    expect(await host([]).checkpoint(runtimes, false)).toMatchObject({ runsc: false });
    // The host-network variant can't restore a sandbox's network stack.
    expect(
      await host([]).checkpoint(
        { 'runsc-systrap-hostnet': { path: 'runsc', runtimeArgs: ['--platform=systrap', '--network=host'] } },
        true,
      ),
    ).toMatchObject({ runsc: false });
    expect(
      await host([]).checkpoint(
        { 'runsc-systrap-hostnet': { runtimeArgs: ['--network=host'] }, 'runsc-custom': { runtimeArgs: [] } },
        true,
      ),
    ).toMatchObject({ runsc: true });
  });

  it('reports gVisor-KVM checkpoints only for a KVM-platform runtime with its own network stack and a ready level', async () => {
    const kvm = { 'runsc-kvm': { path: '/usr/local/bin/runsc', runtimeArgs: ['--platform=kvm'] } };

    expect(await host([]).checkpoint(kvm, true)).toMatchObject({ runscKvm: true });
    expect(await host([]).checkpoint(kvm, true, false)).toMatchObject({ runscKvm: false });
    expect(await host([]).checkpoint(kvm, false)).toMatchObject({ runscKvm: false });
    expect(await host(['/usr/local/bin/runsc']).checkpoint(kvm, true)).toMatchObject({ runscKvm: false });
    expect(await host([]).checkpoint({ 'runsc-kvm': { runtimeArgs: ['--platform=systrap'] } }, true)).toMatchObject({
      runscKvm: false,
    });
    // Not registered: not reported (older control planes see the same capability as before).
    expect(await host([]).checkpoint({}, true)).not.toHaveProperty('runscKvm');
  });

  it('takes the configured transfer rate, else nothing for unknown link speeds', async () => {
    expect(await host([]).transferBitsPerSecond({ LOADWEAVER_TRANSFER_BPS: '10000000000' })).toBe(1e10);
    // A default route's device without a readable link speed (virtual NICs): unknown.
    expect(await host([]).transferBitsPerSecond({})).toBeUndefined();
  });
});
