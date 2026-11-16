/** One Server-Sent Events frame (`event:` defaults to `message`). */
export interface SseFrame {
  event: string;
  data: string;
}

const DEFAULT_MAX_FRAME_CHARS = 4_000_000;

/**
 * Incremental Server-Sent Events parser (WHATWG `text/event-stream`): `event:` / `data:` fields, multi-line data,
 * CRLF / LF / CR line endings and comment frames (`: keep-alive`, skipped). Feed decoded text with {@link push}; an
 * event without its terminating blank line is never emitted.
 */
export class SseParser {
  private buffer = '';
  private event = '';
  private data: string[] = [];
  private dataChars = 0;

  constructor(private readonly maxFrameChars = DEFAULT_MAX_FRAME_CHARS) {}

  /** Parses the next chunk of text; `final` marks the end of the stream (a trailing lone CR ends its line). */
  push(text: string, final = false): SseFrame[] {
    const frames: SseFrame[] = [];
    const lineBreak = /\r\n|\r|\n/g;
    let consumed = 0;
    let match: RegExpExecArray | null;

    this.buffer += text;

    while ((match = lineBreak.exec(this.buffer)) !== null) {
      // A lone trailing CR may be the first half of CRLF: wait for more input.
      if (match[0] === '\r' && match.index === this.buffer.length - 1 && !final) {
        break;
      }

      const line = this.buffer.slice(consumed, match.index);

      consumed = match.index + match[0].length;
      this.line(line, frames);
    }

    this.buffer = this.buffer.slice(consumed);

    if (this.buffer.length > this.maxFrameChars) {
      throw new Error('Server-sent event exceeds the maximum frame size');
    }

    return frames;
  }

  private line(line: string, frames: SseFrame[]): void {
    if (line === '') {
      if (this.data.length > 0) {
        frames.push({ event: this.event || 'message', data: this.data.join('\n') });
      }

      this.event = '';
      this.data = [];
      this.dataChars = 0;

      return;
    }

    if (line.startsWith(':')) {
      return;
    }

    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);

    if (value.startsWith(' ')) {
      value = value.slice(1);
    }

    if (field === 'event') {
      this.event = value;
    } else if (field === 'data') {
      this.dataChars += value.length;

      if (this.dataChars > this.maxFrameChars) {
        throw new Error('Server-sent event exceeds the maximum frame size');
      }

      this.data.push(value);
    }
  }
}

/** Reads the frames of a Server-Sent Events byte stream (browsers and Node 18+). */
export async function* readSseFrames(
  body: ReadableStream<Uint8Array>,
  maxFrameChars = DEFAULT_MAX_FRAME_CHARS,
): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser(maxFrameChars);

  try {
    for (;;) {
      const { value, done } = await reader.read();
      const frames = parser.push(done ? decoder.decode() : decoder.decode(value, { stream: true }), done);

      for (const frame of frames) {
        yield frame;
      }

      if (done) {
        return;
      }
    }
  } finally {
    // Stops the download when the consumer breaks out early (abort, error, early return).
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
