import { resolveApiWebsocketUrl } from './api-websocket.util';

describe('resolveApiWebsocketUrl', () => {
  it('returns null when config is missing', () => {
    expect(resolveApiWebsocketUrl(undefined, 'default')).toBeNull();
  });

  it('returns the string primary for default', () => {
    expect(resolveApiWebsocketUrl('http://localhost:3100/socket/clients', 'default')).toBe(
      'http://localhost:3100/socket/clients',
    );
  });

  it('derives tickets from clients string primary', () => {
    expect(resolveApiWebsocketUrl('http://localhost:3100/socket/clients', 'tickets')).toBe(
      'http://localhost:3100/socket/tickets',
    );
  });

  it('derives inventory from billing string primary', () => {
    expect(resolveApiWebsocketUrl('http://localhost:3200/socket/billing', 'inventory')).toBe(
      'http://localhost:3200/socket/inventory',
    );
  });

  it('derives projects from billing string primary', () => {
    expect(resolveApiWebsocketUrl('http://localhost:3200/socket/billing', 'projects')).toBe(
      'http://localhost:3200/socket/projects',
    );
  });

  it('derives the action center namespace from clients and billing primaries', () => {
    expect(resolveApiWebsocketUrl('http://localhost:3100/socket/clients', 'action-center')).toBe(
      'http://localhost:3100/socket/action-center',
    );
    expect(resolveApiWebsocketUrl('http://localhost:3200/socket/billing', 'action-center')).toBe(
      'http://localhost:3200/socket/action-center',
    );
  });

  it('prefers explicit object endpoints', () => {
    expect(
      resolveApiWebsocketUrl(
        {
          default: 'http://localhost:3100/socket/clients',
          vnc: 'ws://localhost:3100/socket/vnc',
        },
        'vnc',
      ),
    ).toBe('ws://localhost:3100/socket/vnc');
  });
});
