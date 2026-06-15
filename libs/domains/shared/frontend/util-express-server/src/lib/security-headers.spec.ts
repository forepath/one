import {
  createSecurityHeadersMiddleware,
  parseCspConnectSrcExtra,
  parseCspExtraOrigins,
  resolveCspFrameAncestorsSources,
} from './security-headers';

describe('parseCspExtraOrigins', () => {
  it('returns [] for undefined or blank', () => {
    expect(parseCspExtraOrigins(undefined)).toEqual([]);
    expect(parseCspExtraOrigins('  ')).toEqual([]);
  });

  it('returns URL origins for valid http(s)/ws(s) tokens', () => {
    expect(parseCspExtraOrigins('https://example.com/foo, wss://socket.example.com , http://localhost:3000')).toEqual([
      'https://example.com',
      'wss://socket.example.com',
      'http://localhost:3000',
    ]);
  });

  it('ignores invalid URLs and non-http protocols', () => {
    expect(parseCspExtraOrigins('not-a-url ftp://example.com https://ok.example')).toEqual(['https://ok.example']);
  });
});

describe('resolveCspFrameAncestorsSources', () => {
  it("defaults to 'none' when unset or blank", () => {
    expect(resolveCspFrameAncestorsSources(undefined)).toBe("'none'");
    expect(resolveCspFrameAncestorsSources('')).toBe("'none'");
    expect(resolveCspFrameAncestorsSources('  ')).toBe("'none'");
  });

  it('returns trimmed override and normalizes whitespace', () => {
    expect(resolveCspFrameAncestorsSources("'self'")).toBe("'self'");
    expect(resolveCspFrameAncestorsSources('  https://parent.example  ')).toBe('https://parent.example');
    expect(resolveCspFrameAncestorsSources("'self'   https://parent.example")).toBe("'self' https://parent.example");
  });

  it("falls back to 'none' if directive injection is attempted", () => {
    expect(resolveCspFrameAncestorsSources("'self'; script-src *")).toBe("'none'");
    expect(resolveCspFrameAncestorsSources('https://a.example\nhttps://b.example')).toBe("'none'");
  });
});

describe('parseCspConnectSrcExtra', () => {
  it('matches parseCspExtraOrigins', () => {
    expect(parseCspConnectSrcExtra('https://a.example https://b.example')).toEqual(
      parseCspExtraOrigins('https://a.example https://b.example'),
    );
  });
});

describe('createSecurityHeadersMiddleware', () => {
  it('uses CSP report-only by default and includes http/ws connect-src in non-production', () => {
    const headers = new Map<string, string>();
    const middleware = createSecurityHeadersMiddleware({
      NODE_ENV: 'development',
      CSP_CONNECT_SRC_EXTRA: 'https://example.com',
    });

    middleware(
      {},
      {
        setHeader(name, value) {
          headers.set(name, value);
        },
      },
      () => undefined,
    );

    expect(headers.get('Content-Security-Policy-Report-Only')).toContain('connect-src');
    expect(headers.get('Content-Security-Policy-Report-Only')).toContain('http:');
    expect(headers.get('Content-Security-Policy-Report-Only')).toContain('ws:');
    expect(headers.get('Content-Security-Policy-Report-Only')).toContain('https://example.com');
    expect(headers.get('Content-Security-Policy-Report-Only')).toMatch(/worker-src[^;]*'self'[^;]*blob:/);
    expect(headers.get('Content-Security-Policy')).toBeUndefined();
    expect(headers.get('Content-Security-Policy-Report-Only')).toContain("frame-ancestors 'none'");
    expect(headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('overrides frame-ancestors when CSP_FRAME_ANCESTORS is set', () => {
    const headers = new Map<string, string>();
    const middleware = createSecurityHeadersMiddleware({
      NODE_ENV: 'development',
      CSP_FRAME_ANCESTORS: 'https://embedder.example',
    });

    middleware(
      {},
      {
        setHeader(name, value) {
          headers.set(name, value);
        },
      },
      () => undefined,
    );

    expect(headers.get('Content-Security-Policy-Report-Only')).toContain('frame-ancestors https://embedder.example');
    expect(headers.get('X-Frame-Options')).toBeUndefined();
  });

  it("sets X-Frame-Options to SAMEORIGIN when frame-ancestors is only 'self'", () => {
    const headers = new Map<string, string>();
    const middleware = createSecurityHeadersMiddleware({
      NODE_ENV: 'development',
      CSP_FRAME_ANCESTORS: "'self'",
    });

    middleware(
      {},
      {
        setHeader(name, value) {
          headers.set(name, value);
        },
      },
      () => undefined,
    );

    expect(headers.get('Content-Security-Policy-Report-Only')).toContain("frame-ancestors 'self'");
    expect(headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
  });

  it('appends CSP_SCRIPT_SRC_EXTRA origins to script-src', () => {
    const headers = new Map<string, string>();
    const middleware = createSecurityHeadersMiddleware({
      NODE_ENV: 'development',
      CSP_SCRIPT_SRC_EXTRA: 'https://www.googletagmanager.com/gtm.js',
    });

    middleware(
      {},
      {
        setHeader(name, value) {
          headers.set(name, value);
        },
      },
      () => undefined,
    );

    const csp = headers.get('Content-Security-Policy-Report-Only') ?? '';

    expect(csp).toMatch(/script-src[^;]*https:\/\/www\.googletagmanager\.com/);
  });

  it('appends extra origins to worker-src, style-src, img-src, and font-src', () => {
    const headers = new Map<string, string>();
    const middleware = createSecurityHeadersMiddleware({
      NODE_ENV: 'development',
      CSP_WORKER_SRC_EXTRA: 'https://worker.example.com/path',
      CSP_STYLE_SRC_EXTRA: 'https://fonts.googleapis.com',
      CSP_IMG_SRC_EXTRA: 'https://www.google-analytics.com',
      CSP_FONT_SRC_EXTRA: 'https://fonts.gstatic.com',
    });

    middleware(
      {},
      {
        setHeader(name, value) {
          headers.set(name, value);
        },
      },
      () => undefined,
    );

    const csp = headers.get('Content-Security-Policy-Report-Only') ?? '';

    expect(csp).toMatch(/worker-src[^;]*https:\/\/worker\.example\.com/);
    expect(csp).toMatch(/style-src[^;]*https:\/\/fonts\.googleapis\.com/);
    expect(csp).toMatch(/img-src[^;]*https:\/\/www\.google-analytics\.com/);
    expect(csp).toMatch(/font-src[^;]*https:\/\/fonts\.gstatic\.com/);
  });

  it('appends CSP_DEFAULT_SRC_EXTRA origins to default-src', () => {
    const headers = new Map<string, string>();
    const middleware = createSecurityHeadersMiddleware({
      NODE_ENV: 'development',
      CSP_DEFAULT_SRC_EXTRA: 'https://cdn.example.com/assets',
    });

    middleware(
      {},
      {
        setHeader(name, value) {
          headers.set(name, value);
        },
      },
      () => undefined,
    );

    const csp = headers.get('Content-Security-Policy-Report-Only') ?? '';

    expect(csp).toMatch(/default-src[^;]*'self'[^;]*https:\/\/cdn\.example\.com/);
  });

  it('appends CSP_BASE_URI_EXTRA origins to base-uri', () => {
    const headers = new Map<string, string>();
    const middleware = createSecurityHeadersMiddleware({
      NODE_ENV: 'development',
      CSP_BASE_URI_EXTRA: 'https://allowed-base.example/path',
    });

    middleware(
      {},
      {
        setHeader(name, value) {
          headers.set(name, value);
        },
      },
      () => undefined,
    );

    const csp = headers.get('Content-Security-Policy-Report-Only') ?? '';

    expect(csp).toMatch(/base-uri[^;]*'self'[^;]*https:\/\/allowed-base\.example/);
  });

  it('uses CSP enforce when CSP_ENFORCE=true', () => {
    const headers = new Map<string, string>();
    const middleware = createSecurityHeadersMiddleware({
      NODE_ENV: 'development',
      CSP_ENFORCE: 'true',
    });

    middleware(
      {},
      {
        setHeader(name, value) {
          headers.set(name, value);
        },
      },
      () => undefined,
    );

    expect(headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(headers.get('Content-Security-Policy-Report-Only')).toBeUndefined();
  });

  it('adds production-only headers when NODE_ENV=production', () => {
    const headers = new Map<string, string>();
    const middleware = createSecurityHeadersMiddleware({
      NODE_ENV: 'production',
    });

    middleware(
      {},
      {
        setHeader(name, value) {
          headers.set(name, value);
        },
      },
      () => undefined,
    );

    expect(headers.get('Strict-Transport-Security')).toBe('max-age=15552000; includeSubDomains');
    expect(headers.get('Cross-Origin-Resource-Policy')).toBe('same-site');
  });
});
