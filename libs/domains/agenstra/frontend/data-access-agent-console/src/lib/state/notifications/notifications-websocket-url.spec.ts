import { resolveStatusWebsocketUrl } from './notifications-websocket-url';

describe('resolveStatusWebsocketUrl', () => {
  const baseEnvironment = {
    production: false,
    billing: { restApiUrl: '', frontendUrl: '' },
    authentication: { type: 'api-key' as const, apiKey: 'k' },
    chatModelOptions: {},
    cookieConsent: { domain: '', privacyPolicyUrl: '', termsUrl: '' },
  };

  it('derives /status from clients websocket url', () => {
    expect(
      resolveStatusWebsocketUrl({
        ...baseEnvironment,
        controller: { restApiUrl: 'http://localhost:3000', websocketUrl: 'http://localhost:3100/socket/clients' },
      }),
    ).toBe('http://localhost:3100/socket/status');
  });

  it('uses explicit statusWebsocketUrl when set', () => {
    expect(
      resolveStatusWebsocketUrl({
        ...baseEnvironment,
        controller: {
          restApiUrl: 'http://localhost:3000',
          websocketUrl: 'http://localhost:3100/socket/clients',
          statusWebsocketUrl: 'ws://custom/status',
        },
      }),
    ).toBe('ws://custom/status');
  });

  it('returns null when no websocket url is configured', () => {
    expect(
      resolveStatusWebsocketUrl({
        ...baseEnvironment,
        controller: { restApiUrl: 'http://localhost:3000' },
      }),
    ).toBeNull();
  });

  it('derives /status from a generic websocket base url', () => {
    expect(
      resolveStatusWebsocketUrl({
        ...baseEnvironment,
        controller: { restApiUrl: 'http://localhost:3000', websocketUrl: 'ws://localhost:3100/ws' },
      }),
    ).toBe('ws://localhost:3100/socket/status');
  });

  it('appends /status when websocket url is not a valid URL', () => {
    expect(
      resolveStatusWebsocketUrl({
        ...baseEnvironment,
        controller: { restApiUrl: 'http://localhost:3000', websocketUrl: 'not-a-valid-url' },
      }),
    ).toBe('not-a-valid-url/socket/status');
  });

  it('strips trailing slash before appending /status for invalid URLs', () => {
    expect(
      resolveStatusWebsocketUrl({
        ...baseEnvironment,
        controller: { restApiUrl: 'http://localhost:3000', websocketUrl: 'not-a-valid-url/' },
      }),
    ).toBe('not-a-valid-url/socket/status');
  });
});
