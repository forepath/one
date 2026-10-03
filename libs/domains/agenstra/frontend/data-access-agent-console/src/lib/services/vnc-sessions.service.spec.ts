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
  it('prefers explicit vnc websocket endpoint', () => {
    expect(
      resolveVncWebsocketUrl({
        console: {
          urls: {
            restApi: 'http://localhost:3100/api',
            websocket: {
              default: 'http://localhost:3100/socket/clients',
              vnc: 'wss://vnc.example.com/socket/vnc',
            },
          },
        },
      } as never),
    ).toBe('wss://vnc.example.com/socket/vnc');
  });

  it('derives ws URL from console.urls.websocket /clients path', () => {
    expect(
      resolveVncWebsocketUrl({
        console: {
          urls: {
            restApi: 'http://localhost:3100/api',
            websocket: 'http://localhost:3100/socket/clients',
          },
        },
      } as never),
    ).toBe('ws://localhost:3100/socket/vnc');
  });

  it('derives wss URL from https websocket with prefix path', () => {
    expect(
      resolveVncWebsocketUrl({
        console: {
          urls: {
            restApi: 'https://cloud.example.com/v1/api',
            websocket: 'https://cloud.example.com/v1/socket/clients',
          },
        },
      } as never),
    ).toBe('wss://cloud.example.com/v1/socket/vnc');
  });
});
