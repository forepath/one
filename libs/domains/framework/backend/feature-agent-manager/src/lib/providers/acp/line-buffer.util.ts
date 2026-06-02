/**
 * Accumulates stream chunks and yields complete lines (without trailing newline).
 */
export function* drainLineBuffer(buffer: string, chunk: string): Generator<string, string> {
  let remaining = buffer + chunk;
  const parts = remaining.split('\n');

  remaining = parts.pop() ?? '';

  for (const line of parts) {
    if (line.length > 0) {
      yield line;
    }
  }

  return remaining;
}
