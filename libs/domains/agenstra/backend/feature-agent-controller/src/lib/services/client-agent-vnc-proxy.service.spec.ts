import { ClientAgentVncProxyService } from './client-agent-vnc-proxy.service';

describe('ClientAgentVncProxyService', () => {
  it('builds manager VNC ws url from client endpoint host on WEBSOCKET_PORT path /vnc', () => {
    const service = new ClientAgentVncProxyService({} as never, {} as never, {} as never);

    expect(service.buildManagerVncWsUrl('http://agent-manager:3000')).toBe('ws://agent-manager:8080/vnc');
    expect(service.buildManagerVncWsUrl('https://agent-manager.example.com/api')).toBe(
      'wss://agent-manager.example.com:8080/vnc',
    );
    expect(service.buildManagerVncWsUrl('http://agent-manager:3000', 8443)).toBe('ws://agent-manager:8443/vnc');
  });
});
