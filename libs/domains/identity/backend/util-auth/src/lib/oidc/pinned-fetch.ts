import * as http from 'node:http';
import * as https from 'node:https';
import type { LookupFunction } from 'node:net';

import { OIDC_HTTP_MAX_BYTES, type OidcFetch } from './oidc-http';

function toHeaderRecord(headers: RequestInit['headers']): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    const record: Record<string, string> = {};

    headers.forEach((value, name) => {
      record[name] = value;
    });

    return record;
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return { ...(headers as Record<string, string>) };
}

function toResponseHeaders(headers: http.IncomingHttpHeaders): Headers {
  const result = new Headers();

  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => result.append(name, entry));
    } else if (value !== undefined) {
      result.set(name, value);
    }
  }

  return result;
}

/**
 * Minimal `fetch` over node:http(s) whose DNS resolution goes through `lookup` for the actual connection.
 * Used for user-supplied OpenID provider URLs: the address that is validated is the address that is connected to,
 * so DNS rebinding between validation and request is not possible. Redirects are never followed and the response
 * body is capped at {@link OIDC_HTTP_MAX_BYTES}. Only string bodies are supported (form-encoded OAuth requests).
 */
export function createPinnedFetch(lookup: LookupFunction): OidcFetch {
  return (input: string, init: RequestInit = {}) =>
    new Promise<Response>((resolve, reject) => {
      const url = new URL(input);

      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        reject(new Error('Unsupported protocol'));

        return;
      }

      const body = typeof init.body === 'string' ? init.body : undefined;
      const headers = toHeaderRecord(init.headers);

      if (body !== undefined) {
        headers['content-length'] = String(Buffer.byteLength(body));
      }

      const transport = url.protocol === 'https:' ? https : http;
      const request = transport.request(
        url,
        // `agent: false`: never reuse pooled sockets (a keep-alive socket opened elsewhere would bypass `lookup`).
        { method: init.method ?? 'GET', headers, lookup, agent: false, signal: init.signal ?? undefined },
        (response) => {
          const chunks: Buffer[] = [];
          let total = 0;

          response.on('data', (chunk: Buffer) => {
            total += chunk.length;

            if (total > OIDC_HTTP_MAX_BYTES) {
              request.destroy(new Error(`Response exceeds ${OIDC_HTTP_MAX_BYTES} bytes`));

              return;
            }

            chunks.push(chunk);
          });
          response.on('end', () => {
            // Never throw from an event handler (would be an uncaughtException): an attacker-controlled server can
            // send any 3-digit status (e.g. 999) or malformed headers that the Response constructor rejects.
            try {
              const status = response.statusCode ?? 0;

              if (status < 200 || status > 599) {
                throw new Error(`Unsupported HTTP status ${status}`);
              }

              const noBody = status === 204 || status === 205 || status === 304;

              resolve(
                new Response(noBody ? null : Buffer.concat(chunks), {
                  status,
                  headers: toResponseHeaders(response.headers),
                }),
              );
            } catch (error) {
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          });
          response.on('aborted', () => reject(new Error('Response aborted')));
          response.on('error', reject);
        },
      );

      request.on('error', reject);

      if (body !== undefined) {
        request.write(body);
      }

      request.end();
    });
}
