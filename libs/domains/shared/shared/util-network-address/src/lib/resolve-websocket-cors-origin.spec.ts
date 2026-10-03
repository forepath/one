import { resolveWebsocketCorsOrigin, resolveWebsocketCorsOriginEnv } from './resolve-websocket-cors-origin';

describe('resolveWebsocketCorsOriginEnv', () => {
  it('prefers WEBSOCKET_CORS_ORIGIN when set', () => {
    expect(
      resolveWebsocketCorsOriginEnv({
        WEBSOCKET_CORS_ORIGIN: 'https://ws.example.com',
        CORS_ORIGIN: 'https://http.example.com',
      }),
    ).toBe('https://ws.example.com');
  });

  it('falls through to CORS_ORIGIN when WEBSOCKET_CORS_ORIGIN is unset', () => {
    expect(
      resolveWebsocketCorsOriginEnv({
        CORS_ORIGIN: 'https://http.example.com',
      }),
    ).toBe('https://http.example.com');
  });

  it('treats whitespace-only WEBSOCKET_CORS_ORIGIN as unset', () => {
    expect(
      resolveWebsocketCorsOriginEnv({
        WEBSOCKET_CORS_ORIGIN: '   ',
        CORS_ORIGIN: 'https://http.example.com',
      }),
    ).toBe('https://http.example.com');
  });

  it('returns undefined when both are unset or whitespace-only', () => {
    expect(resolveWebsocketCorsOriginEnv({})).toBeUndefined();
    expect(
      resolveWebsocketCorsOriginEnv({
        WEBSOCKET_CORS_ORIGIN: ' ',
        CORS_ORIGIN: '\t',
      }),
    ).toBeUndefined();
  });
});

describe('resolveWebsocketCorsOrigin', () => {
  it('returns * when neither env is set', () => {
    expect(resolveWebsocketCorsOrigin({})).toBe('*');
  });

  it('returns resolved env when present', () => {
    expect(
      resolveWebsocketCorsOrigin({
        CORS_ORIGIN: 'https://app.example.com',
      }),
    ).toBe('https://app.example.com');
  });
});
