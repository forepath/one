import { resolveVncWebsocketUrl, VncSessionsService } from './vnc-sessions.service';

describe('VncSessionsService', () => {
  it('builds websocket url without embedding the ticket', () => {
    const service = Object.create(VncSessionsService.prototype) as VncSessionsService;

    expect(service.buildWebsocketUrl('ws://localhost:3100/socket/vnc')).toBe('ws://localhost:3100/socket/vnc');
    expect(service.buildWebsocketUrl('ws://localhost:3100/socket/vnc/')).toBe('ws://localhost:3100/socket/vnc');
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
          websocketUrl: 'http://localhost:3100/socket/clients',
          vncWebsocketUrl: 'wss://vnc.example.com/socket/vnc',
        },
      } as never),
    ).toBe('wss://vnc.example.com/socket/vnc');
  });

  it('derives ws URL from controller.websocketUrl /clients path', () => {
    expect(
      resolveVncWebsocketUrl({
        controller: {
          restApiUrl: 'http://localhost:3100/api',
          websocketUrl: 'http://localhost:3100/socket/clients',
        },
      } as never),
    ).toBe('ws://localhost:3100/socket/vnc');
  });

  it('derives wss URL from https websocketUrl with prefix path', () => {
    expect(
      resolveVncWebsocketUrl({
        controller: {
          restApiUrl: 'https://cloud.example.com/v1/api',
          websocketUrl: 'https://cloud.example.com/v1/socket/clients',
        },
      } as never),
    ).toBe('wss://cloud.example.com/v1/socket/vnc');
  });
});
