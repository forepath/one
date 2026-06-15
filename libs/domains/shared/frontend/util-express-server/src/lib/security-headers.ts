export interface SecurityHeadersEnv {
  CSP_ENFORCE?: string;
  CSP_DEFAULT_SRC_EXTRA?: string;
  CSP_BASE_URI_EXTRA?: string;
  CSP_CONNECT_SRC_EXTRA?: string;
  CSP_SCRIPT_SRC_EXTRA?: string;
  CSP_WORKER_SRC_EXTRA?: string;
  CSP_STYLE_SRC_EXTRA?: string;
  CSP_IMG_SRC_EXTRA?: string;
  CSP_FONT_SRC_EXTRA?: string;
  CSP_FRAME_ANCESTORS?: string;
  NODE_ENV?: string;
}

/**
 * Parses comma- or space-separated URLs into CSP-safe origins (http, https, ws, wss).
 * Used for optional CSP directive extensions.
 */
export function parseCspExtraOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }

  const tokens = raw
    .split(/[\s,]+/g)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const origins: string[] = [];

  for (const token of tokens) {
    try {
      const url = new URL(token);

      if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'ws:' && url.protocol !== 'wss:') {
        continue;
      }

      origins.push(url.origin);
    } catch {
      // Ignore invalid entries
    }
  }

  return origins;
}

export function parseCspConnectSrcExtra(raw: string | undefined): string[] {
  return parseCspExtraOrigins(raw);
}

export function resolveCspFrameAncestorsSources(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? '';

  if (!trimmed) {
    return "'none'";
  }

  if (/[;\n\r]/.test(trimmed)) {
    return "'none'";
  }

  return trimmed.replace(/\s+/g, ' ');
}

function buildConnectSrc(env: SecurityHeadersEnv): string {
  const unencryptedProtocols = ['http:', 'ws:'];
  const connectSrcExtra = parseCspExtraOrigins(env.CSP_CONNECT_SRC_EXTRA);

  return [
    "'self'",
    'https:',
    'wss:',
    ...(env.NODE_ENV === 'production' ? [] : unencryptedProtocols),
    ...connectSrcExtra,
  ].join(' ');
}

function buildScriptSrc(env: SecurityHeadersEnv): string {
  const scriptSrcExtra = parseCspExtraOrigins(env.CSP_SCRIPT_SRC_EXTRA);
  const base = ["'self'", "'unsafe-inline'", "'unsafe-eval'"];

  return [...base, ...scriptSrcExtra].join(' ');
}

function buildWorkerSrc(env: SecurityHeadersEnv): string {
  const extra = parseCspExtraOrigins(env.CSP_WORKER_SRC_EXTRA);

  return ["'self'", 'blob:', ...extra].join(' ');
}

function buildStyleSrc(env: SecurityHeadersEnv): string {
  const extra = parseCspExtraOrigins(env.CSP_STYLE_SRC_EXTRA);

  return ["'self'", "'unsafe-inline'", ...extra].join(' ');
}

function buildImgSrc(env: SecurityHeadersEnv): string {
  const extra = parseCspExtraOrigins(env.CSP_IMG_SRC_EXTRA);

  return ["'self'", 'data:', ...extra].join(' ');
}

function buildFontSrc(env: SecurityHeadersEnv): string {
  const extra = parseCspExtraOrigins(env.CSP_FONT_SRC_EXTRA);

  return ["'self'", 'data:', ...extra].join(' ');
}

function buildDefaultSrc(env: SecurityHeadersEnv): string {
  const extra = parseCspExtraOrigins(env.CSP_DEFAULT_SRC_EXTRA);

  return ["'self'", ...extra].join(' ');
}

function buildBaseUri(env: SecurityHeadersEnv): string {
  const extra = parseCspExtraOrigins(env.CSP_BASE_URI_EXTRA);

  return ["'self'", ...extra].join(' ');
}

function buildCspHeaderValue(env: SecurityHeadersEnv): string {
  const defaultSrc = buildDefaultSrc(env);
  const baseUri = buildBaseUri(env);
  const connectSrc = buildConnectSrc(env);
  const scriptSrc = buildScriptSrc(env);
  const workerSrc = buildWorkerSrc(env);
  const styleSrc = buildStyleSrc(env);
  const imgSrc = buildImgSrc(env);
  const fontSrc = buildFontSrc(env);
  const frameAncestors = resolveCspFrameAncestorsSources(env.CSP_FRAME_ANCESTORS);

  return [
    `default-src ${defaultSrc}`,
    // Monaco and some tooling commonly require eval; keep report-only by default.
    `script-src ${scriptSrc}`,
    `worker-src ${workerSrc}`,
    `style-src ${styleSrc}`,
    `img-src ${imgSrc}`,
    `font-src ${fontSrc}`,
    `connect-src ${connectSrc}`,
    `frame-ancestors ${frameAncestors}`,
    `base-uri ${baseUri}`,
  ].join('; ');
}

export type ExpressLikeResponse = {
  setHeader(name: string, value: string): void;
};

export type ExpressLikeNext = () => void;

export type ExpressLikeMiddleware = (req: unknown, res: ExpressLikeResponse, next: ExpressLikeNext) => void;

/**
 * Creates a security headers middleware shared across frontend Express servers.
 * Uses CSP in report-only mode by default; set CSP_ENFORCE=true to enforce.
 */
export function createSecurityHeadersMiddleware(env?: SecurityHeadersEnv): ExpressLikeMiddleware {
  const safeEnv = (env ?? (process.env as unknown as SecurityHeadersEnv)) as SecurityHeadersEnv;
  const enforceCsp = safeEnv.CSP_ENFORCE?.trim().toLowerCase() === 'true';
  const cspHeader = enforceCsp ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';
  const cspHeaderValue = buildCspHeaderValue(safeEnv);
  const isProduction = safeEnv.NODE_ENV === 'production';
  const frameAncestorsSources = resolveCspFrameAncestorsSources(safeEnv.CSP_FRAME_ANCESTORS);

  return (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (frameAncestorsSources === "'none'") {
      res.setHeader('X-Frame-Options', 'DENY');
    } else if (frameAncestorsSources === "'self'") {
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    }

    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader(cspHeader, cspHeaderValue);

    if (isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    }

    next();
  };
}
