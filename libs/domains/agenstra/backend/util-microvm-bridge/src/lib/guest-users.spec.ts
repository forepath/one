import { UnknownUserError, buildProcessEnv, resolveUserSpec, wrapForUser } from './guest-users';

const PASSWD = [
  'root:x:0:0:root:/root:/bin/bash',
  'agenstra:x:10001:10001::/home/agenstra:/bin/bash',
  'broken line',
].join('\n');
const GROUP = ['root:x:0:', 'agenstra:x:10001:', 'staff:x:50:agenstra'].join('\n');

describe('guest user resolution', () => {
  it('resolves names, numeric ids and groups like docker exec', () => {
    expect(resolveUserSpec('', PASSWD, GROUP)).toEqual({ uid: 0, gid: 0, name: 'root', home: '/root' });
    expect(resolveUserSpec('agenstra', PASSWD, GROUP)).toEqual({
      uid: 10001,
      gid: 10001,
      name: 'agenstra',
      home: '/home/agenstra',
    });
    expect(resolveUserSpec('10001', PASSWD, GROUP).name).toBe('agenstra');
    expect(resolveUserSpec('4242', PASSWD, GROUP)).toEqual({ uid: 4242, gid: 0, name: null, home: '/' });
    expect(resolveUserSpec('agenstra:staff', PASSWD, GROUP).gid).toBe(50);
    expect(resolveUserSpec('4242:4243', PASSWD, GROUP).gid).toBe(4243);
  });

  it('fails for unknown names', () => {
    expect(() => resolveUserSpec('nobody', PASSWD, GROUP)).toThrow(UnknownUserError);
    expect(() => resolveUserSpec('agenstra:missing', PASSWD, GROUP)).toThrow(/unable to find group/);
  });

  it('wraps commands with setpriv only when the ids differ', () => {
    const agenstra = resolveUserSpec('agenstra', PASSWD, GROUP);

    expect(wrapForUser(['id'], agenstra, { uid: 0, gid: 0 })).toEqual([
      '/usr/bin/setpriv',
      '--reuid=10001',
      '--regid=10001',
      '--init-groups',
      '--',
      'id',
    ]);
    expect(wrapForUser(['id'], resolveUserSpec('4242', PASSWD, GROUP), { uid: 0, gid: 0 })).toContain('--clear-groups');
    expect(wrapForUser(['id'], resolveUserSpec('root', PASSWD, GROUP), { uid: 0, gid: 0 })).toEqual(['id']);
  });

  it('derives HOME from the user unless the environment sets it', () => {
    const agenstra = resolveUserSpec('agenstra', PASSWD, GROUP);

    expect(buildProcessEnv(['A=1'], ['B=2=3'], agenstra)).toEqual({
      A: '1',
      B: '2=3',
      HOME: '/home/agenstra',
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    });
    expect(buildProcessEnv(['HOME=/app', 'PATH=/x'], [], agenstra)).toEqual({ HOME: '/app', PATH: '/x' });
  });
});
