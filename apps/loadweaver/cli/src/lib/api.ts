import type { CliConfig } from './config';
import { checkClusterVersion } from './version';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(
      `HTTP ${status}: ${typeof body === 'object' && body && 'message' in body ? JSON.stringify((body as { message: unknown }).message) : String(body)}`,
    );
  }
}

/** A thin client of the control-plane API (bearer token: PAT or session). */
export class Api {
  constructor(readonly config: Required<Pick<CliConfig, 'url'>> & CliConfig) {}

  get base(): string {
    return this.config.url.replace(/\/+$/, '');
  }

  async request<T>(method: string, path: string, body?: unknown, token = this.config.token): Promise<T> {
    const response = await fetch(`${this.base}/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    return await this.parse<T>(response);
  }

  /** Streams a file as the raw body (release bundles: `application/x-tar`). */
  async upload<T>(path: string, body: NodeJS.ReadableStream, contentType: string): Promise<T> {
    const response = await fetch(`${this.base}/api${path}`, {
      method: 'POST',
      headers: {
        'content-type': contentType,
        ...(this.config.token ? { authorization: `Bearer ${this.config.token}` } : {}),
      },
      body: body as unknown as BodyInit,
      duplex: 'half',
    } as RequestInit);

    return await this.parse<T>(response);
  }

  private async parse<T>(response: Response): Promise<T> {
    checkClusterVersion(response.headers.get('x-loadweaver-version'));

    const text = await response.text();
    const parsed: unknown = text
      ? (() => {
          try {
            return JSON.parse(text);
          } catch {
            return text;
          }
        })()
      : null;

    if (!response.ok) throw new ApiError(response.status, parsed);

    return parsed as T;
  }
}
