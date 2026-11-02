import { Transform } from 'node:stream';

/** Raised when a relayed body exceeds its limit. */
export class StreamLimitError extends Error {
  constructor(readonly max: number) {
    super(`body larger than ${max} bytes`);
    this.name = 'StreamLimitError';
  }
}

/** Passes at most `max` bytes, then fails the stream with {@link StreamLimitError}; counts what passed. */
export function byteLimit(max: number): Transform & { bytes: () => number } {
  let seen = 0;
  const transform = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;

      if (seen > max) callback(new StreamLimitError(max));
      else callback(null, chunk);
    },
  }) as Transform & { bytes: () => number };

  transform.bytes = () => seen;

  return transform;
}
