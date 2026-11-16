import { readSseFrames, SseParser, type SseFrame } from './sse-reader';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

async function collect(chunks: string[]): Promise<SseFrame[]> {
  const frames: SseFrame[] = [];

  for await (const frame of readSseFrames(streamOf(chunks))) {
    frames.push(frame);
  }

  return frames;
}

describe('readSseFrames', () => {
  it('parses event and data fields and skips comments', async () => {
    await expect(
      collect([': keep-alive\n\n', 'event: response.created\ndata: {"a":1}\n\n', 'data: [DONE]\n\n']),
    ).resolves.toEqual([
      { event: 'response.created', data: '{"a":1}' },
      { event: 'message', data: '[DONE]' },
    ]);
  });

  it('handles frames split across chunks and CRLF line endings', async () => {
    await expect(collect(['event: x\r', '\ndata: hel', 'lo\r\n', '\r\n'])).resolves.toEqual([
      { event: 'x', data: 'hello' },
    ]);
  });

  it('joins multi-line data and discards an unterminated trailing frame', async () => {
    await expect(collect(['data: a\ndata: b\n\ndata: tail'])).resolves.toEqual([{ event: 'message', data: 'a\nb' }]);
  });

  it('rejects frames above the size limit', async () => {
    const iterator = readSseFrames(streamOf([`data: ${'x'.repeat(50)}\n\n`]), 10);

    await expect(iterator.next()).rejects.toThrow('maximum frame size');
  });
});

describe('SseParser', () => {
  it('parses text pushed in arbitrary pieces', () => {
    const parser = new SseParser();

    expect(parser.push('event: a\nda')).toEqual([]);
    expect(parser.push('ta: 1\n')).toEqual([]);
    expect(parser.push('\ndata: 2\n\n')).toEqual([
      { event: 'a', data: '1' },
      { event: 'message', data: '2' },
    ]);
  });
});
