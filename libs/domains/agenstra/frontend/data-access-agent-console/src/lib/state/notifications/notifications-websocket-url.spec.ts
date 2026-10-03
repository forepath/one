import { resolveStatusWebsocketUrl } from './notifications-websocket-url';

describe('resolveStatusWebsocketUrl', () => {
  const baseEnvironment = {
    application: { production: false, productName: 'Agenstra' },
    console: {
      urls: {
        restApi: '',
      },
    },
    authentication: {
      config: { type: 'api-key' as const, apiKey: 'k' },
      marketing: {
        loginDescription: '',
        registerDescription: '',
        requestPasswordResetDescription: '',
        resetPasswordConfirmationDescription: '',
        resetPasswordDescription: '',
        confirmEmailDescription: '',
        features: [],
      },
    },
    chatModelOptions: {},
    cookieConsent: {
      enabled: true,
      domain: '',
      urls: { privacyPolicy: '', terms: '' },
    },
    socialPreview: { urls: { image: '' } },
  } as const;

  it('derives /status from clients websocket url', () => {
    expect(
      resolveStatusWebsocketUrl({
        ...baseEnvironment,
        console: {
          urls: {
            restApi: 'http://localhost:3000',
            websocket: 'http://localhost:3100/socket/clients',
          },
        },
      } as never),
    ).toBe('http://localhost:3100/socket/status');
  });

  it('uses explicit status websocket when set', () => {
    expect(
      resolveStatusWebsocketUrl({
        ...baseEnvironment,
        console: {
          urls: {
            restApi: 'http://localhost:3000',
            websocket: {
              default: 'http://localhost:3100/socket/clients',
              status: 'ws://custom/status',
            },
          },
        },
      } as never),
    ).toBe('ws://custom/status');
  });

  it('returns null when no websocket url is configured', () => {
    expect(
      resolveStatusWebsocketUrl({
        ...baseEnvironment,
        console: {
          urls: {
            restApi: 'http://localhost:3000',
            websocket: undefined as never,
          },
        },
      } as never),
    ).toBeNull();
  });

  it('derives /status from a generic websocket base url', () => {
    expect(
      resolveStatusWebsocketUrl({
        ...baseEnvironment,
        console: {
          urls: {
            restApi: 'http://localhost:3000',
            websocket: 'ws://localhost:3100/ws',
          },
        },
      } as never),
    ).toBe('ws://localhost:3100/socket/status');
  });

  it('appends /status when websocket url is not a valid URL', () => {
    expect(
      resolveStatusWebsocketUrl({
        ...baseEnvironment,
        console: {
          urls: {
            restApi: 'http://localhost:3000',
            websocket: 'not-a-valid-url',
          },
        },
      } as never),
    ).toBe('not-a-valid-url/socket/status');
  });

  it('strips trailing slash before appending /status for invalid URLs', () => {
    expect(
      resolveStatusWebsocketUrl({
        ...baseEnvironment,
        console: {
          urls: {
            restApi: 'http://localhost:3000',
            websocket: 'not-a-valid-url/',
          },
        },
      } as never),
    ).toBe('not-a-valid-url/socket/status');
  });
});
