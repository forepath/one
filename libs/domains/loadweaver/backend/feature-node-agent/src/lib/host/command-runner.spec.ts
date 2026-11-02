import { CommandRunner } from './command-runner';

describe('CommandRunner env', () => {
  it('adds extra variables to the fixed base environment (PATH / LC_ALL stay)', async () => {
    const { stdout } = await new CommandRunner().run('env', [], {
      env: { LIBMOUNT_FORCE_MOUNT2: 'always', PATH: '/evil', LC_ALL: 'xx' },
    });
    const vars = Object.fromEntries(
      stdout
        .trim()
        .split('\n')
        .map((l) => l.split(/=(.*)/s).slice(0, 2)),
    );

    expect(vars['LIBMOUNT_FORCE_MOUNT2']).toBe('always');
    expect(vars['PATH']).toBe('/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin');
    expect(vars['LC_ALL']).toBe('C');
    expect(vars['HOME']).toBeUndefined();
  });
});
