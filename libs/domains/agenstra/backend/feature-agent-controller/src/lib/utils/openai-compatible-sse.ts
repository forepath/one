import type { Response } from 'express';

/** Comment frames keep idle connections (reverse proxies, load balancers) open while the agent works. */
export const OPENAI_SSE_KEEP_ALIVE_MS = 15_000;

/** Minimal Server-Sent Events writer for the OpenAI-compatible streaming endpoints. */
export class OpenAiSseWriter {
  private keepAlive?: ReturnType<typeof setInterval>;

  constructor(private readonly res: Response) {}

  get started(): boolean {
    return this.res.headersSent;
  }

  get closed(): boolean {
    return this.res.writableEnded || this.res.destroyed;
  }

  start(headers: Record<string, string> = {}): void {
    this.res.status(200);
    this.res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    this.res.setHeader('Cache-Control', 'no-cache, no-transform');
    this.res.setHeader('Connection', 'keep-alive');
    // Disable response buffering in nginx-style reverse proxies.
    this.res.setHeader('X-Accel-Buffering', 'no');

    for (const [name, value] of Object.entries(headers)) {
      this.res.setHeader(name, value);
    }

    this.res.flushHeaders();
    this.keepAlive = setInterval(() => this.write(': keep-alive\n\n'), OPENAI_SSE_KEEP_ALIVE_MS);
    this.keepAlive.unref?.();
  }

  /** `data:` frame (Chat Completions) or `event:` + `data:` frame (Responses). */
  send(data: unknown, event?: string): void {
    this.write(
      `${event ? `event: ${event}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`,
    );
  }

  end(): void {
    this.stopKeepAlive();

    if (!this.closed) {
      this.res.end();
    }
  }

  stopKeepAlive(): void {
    if (this.keepAlive) {
      clearInterval(this.keepAlive);
      this.keepAlive = undefined;
    }
  }

  private write(chunk: string): void {
    if (!this.closed) {
      this.res.write(chunk);
    }
  }
}
