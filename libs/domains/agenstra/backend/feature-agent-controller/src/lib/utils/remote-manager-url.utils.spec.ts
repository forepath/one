import { buildRemoteAgentsSocketUrl, buildRemoteVncWsUrl } from './remote-manager-url.utils';

describe('remote-manager-url.utils', () => {
  it('builds agents socket url from endpoint origin', () => {
    expect(buildRemoteAgentsSocketUrl('http://agent-manager:3000')).toBe('http://agent-manager:3000/socket/agents');
    expect(buildRemoteAgentsSocketUrl('https://agent-manager.example.com/api')).toBe(
      'https://agent-manager.example.com/socket/agents',
    );
    expect(buildRemoteAgentsSocketUrl('http://localhost:3100/api')).toBe('http://localhost:3100/socket/agents');
  });

  it('builds VNC ws url from endpoint origin', () => {
    expect(buildRemoteVncWsUrl('http://agent-manager:3000')).toBe('ws://agent-manager:3000/socket/vnc');
    expect(buildRemoteVncWsUrl('https://agent-manager.example.com/api')).toBe(
      'wss://agent-manager.example.com/socket/vnc',
    );
  });
});
