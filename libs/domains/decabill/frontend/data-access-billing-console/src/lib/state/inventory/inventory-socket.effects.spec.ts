import type { Environment } from '@forepath/decabill/frontend/util-configuration';

import { resolveInventoryWebsocketUrl } from './inventory-socket.effects';

function env(websocket: unknown): Environment {
  return { billing: { urls: { websocket } } } as unknown as Environment;
}

describe('resolveInventoryWebsocketUrl', () => {
  it('derives the inventory namespace from the billing socket URL', () => {
    expect(resolveInventoryWebsocketUrl(env('https://api.example.com/socket/billing'))).toBe(
      'https://api.example.com/socket/inventory',
    );
  });

  it('prefers an explicit inventory URL', () => {
    expect(
      resolveInventoryWebsocketUrl(
        env({ default: 'https://api.example.com/socket/billing', inventory: 'wss://live.example.com/inv' }),
      ),
    ).toBe('wss://live.example.com/inv');
  });

  it('returns null without a websocket URL', () => {
    expect(resolveInventoryWebsocketUrl(env(undefined))).toBeNull();
  });
});
