import { resolveVncWebsocketUrl, VncSessionsService } from './vnc-sessions.service';

describe('VncSessionsService', () => {
  it('builds websocket url without embedding the ticket', () => {
    const service = Object.create(VncSessionsService.prototype) as VncSessionsService;

    expect(service.buildWebsocketUrl('ws://localhost:8081/vnc')).toBe('ws://localhost:8081/vnc');
    expect(service.buildWebsocketUrl('ws://localhost:8081/vnc/')).toBe('ws://localhost:8081/vnc');
  });

  it('builds websocket protocols with binary and ticket token', () => {
    const service = Object.create(VncSessionsService.prototype) as VncSessionsService;

    expect(service.buildWebsocketProtocols('abc-ticket')).toEqual(['binary', 'agenstra.vnc.abc-ticket']);
  });
});

describe('resolveVncWebsocketUrl', () => {
  it('prefers explicit vncWebsocketUrl', () => {
    expect(
      resolveVncWebsocketUrl({
        controller: {
          restApiUrl: 'http://localhost:3100/api',
          websocketUrl: 'http://localhost:8081/clients',
          vncWebsocketUrl: 'wss://vnc.example.com/vnc',
        },
      } as never),
    ).toBe('wss://vnc.example.com/vnc');
  });

  it('derives ws URL from controller.websocketUrl /clients path', () => {
    expect(
      resolveVncWebsocketUrl({
        controller: {
          restApiUrl: 'http://localhost:3100/api',
          websocketUrl: 'http://localhost:8081/clients',
        },
      } as never),
    ).toBe('ws://localhost:8081/vnc');
  });

  it('derives wss URL from https websocketUrl with prefix path', () => {
    expect(
      resolveVncWebsocketUrl({
        controller: {
          restApiUrl: 'https://cloud.example.com/v1/api',
          websocketUrl: 'https://cloud.example.com/v1/clients',
        },
      } as never),
    ).toBe('wss://cloud.example.com/v1/vnc');
  });
});
