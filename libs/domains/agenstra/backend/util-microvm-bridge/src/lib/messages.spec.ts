import {
  isValidUserSpec,
  parseBootConfig,
  parseExecExit,
  parseExecRequest,
  parseOpenTcp,
  parseSignal,
} from './messages';

describe('bridge messages', () => {
  const boot = {
    argv: ['/usr/local/bin/docker-entrypoint.sh'],
    env: ['PATH=/usr/bin', 'HOME=/home/agenstra'],
    workdir: '/app',
    user: '',
    hostname: 'worker-1',
    hosts: '127.0.0.1 localhost\n',
    dnsSearch: 'example.internal',
    dnsOptions: 'ndots:0',
    loopbackPorts: [3128, 3128],
  };

  it('accepts a complete boot configuration and de-duplicates loopback ports', () => {
    expect(parseBootConfig(boot)).toEqual({ ...boot, loopbackPorts: [3128] });
  });

  it.each([
    ['empty argv', { argv: [] }],
    ['malformed env', { env: ['NOT_AN_ASSIGNMENT'] }],
    ['NUL bytes', { argv: ['/bin/sh\0-c'] }],
    ['relative workdir', { workdir: 'app' }],
    ['shell-like user', { user: 'root;id' }],
    ['invalid hostname', { hostname: '-bad' }],
    ['invalid loopback port', { loopbackPorts: [70000] }],
    ['resolver injection', { dnsOptions: 'ndots:0\nnameserver 8.8.8.8' }],
  ])('rejects a boot configuration with %s', (_label, override) => {
    expect(() => parseBootConfig({ ...boot, ...override })).toThrow();
  });

  it('normalises exec requests', () => {
    expect(parseExecRequest({ argv: ['ls'], tty: true, cols: 5000 })).toEqual({
      argv: ['ls'],
      env: [],
      user: '',
      workdir: '',
      tty: true,
      cols: 1000,
      rows: 24,
    });
    expect(() => parseExecRequest({ argv: ['ls'], workdir: 'relative' })).toThrow(/working directory/);
    expect(() => parseExecRequest({ argv: 'ls' })).toThrow(/argv/);
  });

  it('validates users, ports, exits and signals', () => {
    expect(['', 'agenstra', '0', '10001:10001', 'agenstra:staff'].every(isValidUserSpec)).toBe(true);
    expect(['root user', 'a:b:c', '../x', '$(id)'].some(isValidUserSpec)).toBe(false);
    expect(parseOpenTcp({ port: 4096 })).toEqual({ port: 4096 });
    expect(() => parseOpenTcp({ port: 0 })).toThrow(/port/);
    expect(parseExecExit({ code: 300, signal: 'SIGKILL' })).toEqual({ code: 255, signal: 'SIGKILL' });
    expect(parseSignal(Buffer.from('SIGINT'))).toBe('SIGINT');
    expect(parseSignal(Buffer.from('SIGSTOP'))).toBeNull();
  });
});
