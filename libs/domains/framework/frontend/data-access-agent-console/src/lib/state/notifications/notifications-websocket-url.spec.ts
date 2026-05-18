import { resolveStatusWebsocketUrl } from './notifications-websocket-url';

describe('resolveStatusWebsocketUrl', () => {
  const baseEnvironment = {
    production: false,
    billing: { restApiUrl: '', frontendUrl: '' },
    authentication: { type: 'api-key' as const, apiKey: 'k' },
    chatModelOptions: {},
    editor: { openInNewWindow: false },
    deployment: { openInNewWindow: false },
    cookieConsent: { domain: '', privacyPolicyUrl: '', termsUrl: '' },
  };

  it('derives /status from clients websocket url', () => {
    expect(
      resolveStatusWebsocketUrl({
        ...baseEnvironment,
        controller: { restApiUrl: 'http://localhost:3000', websocketUrl: 'http://localhost:8081/clients' },
      }),
    ).toBe('http://localhost:8081/status');
  });

  it('uses explicit statusWebsocketUrl when set', () => {
    expect(
      resolveStatusWebsocketUrl({
        ...baseEnvironment,
        controller: {
          restApiUrl: 'http://localhost:3000',
          websocketUrl: 'http://localhost:8081/clients',
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
        controller: { restApiUrl: 'http://localhost:3000', websocketUrl: 'ws://localhost:8081/ws' },
      }),
    ).toBe('ws://localhost:8081/status');
  });

  it('appends /status when websocket url is not a valid URL', () => {
    expect(
      resolveStatusWebsocketUrl({
        ...baseEnvironment,
        controller: { restApiUrl: 'http://localhost:3000', websocketUrl: 'not-a-valid-url' },
      }),
    ).toBe('not-a-valid-url/status');
  });

  it('strips trailing slash before appending /status for invalid URLs', () => {
    expect(
      resolveStatusWebsocketUrl({
        ...baseEnvironment,
        controller: { restApiUrl: 'http://localhost:3000', websocketUrl: 'not-a-valid-url/' },
      }),
    ).toBe('not-a-valid-url/status');
  });
});
