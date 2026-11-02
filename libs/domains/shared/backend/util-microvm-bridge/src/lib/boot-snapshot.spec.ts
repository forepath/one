import { parseEnvSnapshot, readBootSnapshot } from './boot-snapshot';

describe('boot snapshot', () => {
  it('starts from the worker image environment and overlays what the agent manager set', () => {
    const boot = readBootSnapshot({
      workerEnv: parseEnvSnapshot(
        [
          'PATH=/home/agenstra/.nvm/bin:/usr/bin',
          'HOME=/home/agenstra',
          'HOSTNAME=buildkit',
          'PWD=/app',
          'OPENCODE_SERVER_PORT=4096',
          'broken',
          '',
        ].join('\0'),
      ),
      workerWorkdir: '/app',
      containerEnv: {
        PATH: '/usr/sbin:/usr/bin',
        HOME: '/root',
        HOSTNAME: 'abc123',
        AGENSTRA_MICROVM_FORWARD_PORTS: '4096,6080',
        OPENCODE_SERVER_PORT: '5000',
        HTTP_PROXY: 'http://127.0.0.1:3128',
      },
      hostname: 'abc123',
      hosts: '127.0.0.1 localhost\n172.17.0.2 abc123\n',
      resolvConf: 'nameserver 127.0.0.11\nsearch corp.example  lab\noptions ndots:0\n',
      argv: ['/usr/local/bin/docker-entrypoint.sh'],
      user: '',
      loopbackPorts: [3128],
    });

    expect(boot.env).toEqual([
      'PATH=/home/agenstra/.nvm/bin:/usr/bin',
      'HOME=/home/agenstra',
      'OPENCODE_SERVER_PORT=5000',
      'HTTP_PROXY=http://127.0.0.1:3128',
    ]);
    expect(boot).toMatchObject({
      workdir: '/app',
      hostname: 'abc123',
      dnsSearch: 'corp.example lab',
      dnsOptions: 'ndots:0',
      loopbackPorts: [3128],
    });
  });
});
