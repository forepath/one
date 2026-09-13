import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Response } from 'express';

import { fetchRuntimeConfigFromEnv } from '@forepath/shared/frontend/util-runtime-config-server';

import { computeStrongContentEtag } from './static-memory-cache';
import {
  RUNTIME_CONFIG_ELEMENT_ID,
  escapeJsonForHtmlScript,
  injectRuntimeConfigIntoHtml,
  resolveRuntimeConfigJsonForHtml,
  sendIndexHtmlWithRuntimeConfig,
} from './runtime-config-html';

jest.mock('@forepath/shared/frontend/util-runtime-config-server', () => ({
  fetchRuntimeConfigFromEnv: jest.fn(),
}));

const mockedFetchRuntimeConfigFromEnv = fetchRuntimeConfigFromEnv as jest.Mock;

function mockRes(): Response & {
  statusCode: number;
  headers: Record<string, string | number>;
  body?: Buffer | string;
} {
  const state: {
    statusCode: number;
    headers: Record<string, string | number>;
    body?: Buffer | string;
  } = {
    statusCode: 200,
    headers: {},
  };

  const res = {
    get statusCode() {
      return state.statusCode;
    },
    get headers() {
      return state.headers;
    },
    get body() {
      return state.body;
    },
    status(code: number) {
      state.statusCode = code;

      return this;
    },
    setHeader(name: string, value: string | number) {
      state.headers[name.toLowerCase()] = value;
    },
    end(body?: Buffer | string) {
      state.body = body;
    },
  };

  return res as unknown as Response & {
    statusCode: number;
    headers: Record<string, string | number>;
    body?: Buffer | string;
  };
}

describe('runtime-config-html', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('escapeJsonForHtmlScript', () => {
    it('escapes < to prevent script breakout', () => {
      expect(escapeJsonForHtmlScript('{"x":"</script>"}')).toBe('{"x":"\\u003c/script>"}');
    });
  });

  describe('injectRuntimeConfigIntoHtml', () => {
    it('injects before </head> with the shared element id', () => {
      const html = '<html><head><title>t</title></head><body></body></html>';
      const out = injectRuntimeConfigIntoHtml(html, { billing: { frontendUrl: 'https://x' } });

      expect(out).toContain(`id="${RUNTIME_CONFIG_ELEMENT_ID}"`);
      expect(out).toContain('"frontendUrl":"https://x"');
      expect(out.indexOf('runtime-config')).toBeLessThan(out.toLowerCase().indexOf('</head>'));
    });

    it('does not double-inject when the element already exists', () => {
      const html =
        '<html><head><script type="application/json" id="runtime-config">{}</script></head><body></body></html>';

      expect(injectRuntimeConfigIntoHtml(html, { a: 1 })).toBe(html);
    });

    it('falls back to </body> when head is missing', () => {
      const html = '<html><body><app-root></app-root></body></html>';
      const out = injectRuntimeConfigIntoHtml(html, {});

      expect(out.indexOf('runtime-config')).toBeLessThan(out.toLowerCase().indexOf('</body>'));
    });

    it('changes content hash when config JSON changes', () => {
      const html = '<html><head></head><body></body></html>';
      const a = Buffer.from(injectRuntimeConfigIntoHtml(html, { v: 1 }), 'utf8');
      const b = Buffer.from(injectRuntimeConfigIntoHtml(html, { v: 2 }), 'utf8');

      expect(computeStrongContentEtag(a)).not.toBe(computeStrongContentEtag(b));
      expect(computeStrongContentEtag(a)).toBe(
        computeStrongContentEtag(Buffer.from(injectRuntimeConfigIntoHtml(html, { v: 1 }), 'utf8')),
      );
    });
  });

  describe('resolveRuntimeConfigJsonForHtml', () => {
    it('returns proxied JSON on success', async () => {
      mockedFetchRuntimeConfigFromEnv.mockResolvedValue({ kind: 'ok', value: { a: 1 } });

      await expect(resolveRuntimeConfigJsonForHtml({})).resolves.toEqual({ a: 1 });
    });

    it('returns {} on no_config without logging error', async () => {
      mockedFetchRuntimeConfigFromEnv.mockResolvedValue({ kind: 'no_config' });
      const logger = { error: jest.fn(), warn: jest.fn() };

      await expect(resolveRuntimeConfigJsonForHtml({}, logger)).resolves.toEqual({});
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('returns {} and logs on error', async () => {
      mockedFetchRuntimeConfigFromEnv.mockResolvedValue({ kind: 'error', statusCode: 502, log: 'boom' });
      const logger = { error: jest.fn(), warn: jest.fn() };

      await expect(resolveRuntimeConfigJsonForHtml({}, logger)).resolves.toEqual({});
      expect(logger.error).toHaveBeenCalledWith('boom');
    });
  });

  describe('sendIndexHtmlWithRuntimeConfig', () => {
    let indexPath: string;

    beforeEach(() => {
      const dir = mkdtempSync(join(tmpdir(), 'runtime-config-html-'));

      indexPath = join(dir, 'index.html');
      writeFileSync(
        indexPath,
        '<html><head><title>spa</title></head><body><app-root></app-root></body></html>',
        'utf8',
      );
      mockedFetchRuntimeConfigFromEnv.mockResolvedValue({
        kind: 'ok',
        value: { billing: { frontendUrl: 'https://inline.example' } },
      });
    });

    it('serves HTML with inlined config and revalidate cache headers', async () => {
      const res = mockRes();

      await sendIndexHtmlWithRuntimeConfig(res, indexPath, { headers: {} });

      expect(res.statusCode).toBe(200);
      expect(String(res.headers['cache-control'])).toContain('must-revalidate');
      expect(res.headers['etag']).toBeDefined();

      const body = String(res.body);

      expect(body).toContain(`id="${RUNTIME_CONFIG_ELEMENT_ID}"`);
      expect(body).toContain('https://inline.example');
      expect(body.indexOf('runtime-config')).toBeLessThan(body.toLowerCase().indexOf('</head>'));
    });

    it('returns 304 when If-None-Match matches injected ETag', async () => {
      const first = mockRes();

      await sendIndexHtmlWithRuntimeConfig(first, indexPath, { headers: {} });

      const etag = String(first.headers['etag']);
      const second = mockRes();

      await sendIndexHtmlWithRuntimeConfig(second, indexPath, {
        headers: { 'if-none-match': etag },
      });

      expect(second.statusCode).toBe(304);
      expect(second.body).toBeUndefined();
    });

    it('busts ETag when CONFIG JSON changes', async () => {
      const first = mockRes();

      await sendIndexHtmlWithRuntimeConfig(first, indexPath, { headers: {} });

      mockedFetchRuntimeConfigFromEnv.mockResolvedValue({
        kind: 'ok',
        value: { billing: { frontendUrl: 'https://changed.example' } },
      });

      const second = mockRes();

      await sendIndexHtmlWithRuntimeConfig(second, indexPath, { headers: {} });

      expect(first.headers['etag']).not.toBe(second.headers['etag']);
      expect(String(second.body)).toContain('https://changed.example');
    });
  });
});
