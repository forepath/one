import { createHash } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import { crc32 } from 'node:zlib';

import {
  chunkStringToSign,
  constantTimeEqualHex,
  signatureHex,
  trailerStringToSign,
  type VerifiedRequest,
} from './s3-sigv4';

/** Largest chunk header line accepted (`<hex>;chunk-signature=<64 hex>` is ~90 bytes). */
const MAX_LINE = 256;
/** Largest trailer section accepted. */
const MAX_TRAILER = 4096;
/** Largest single chunk accepted (clients use 64 KiB – 8 MiB). */
const MAX_CHUNK = 64 * 1024 ** 2;

export class ChunkedPayloadError extends Error {}

type State = 'header' | 'data' | 'data-crlf' | 'trailer' | 'done';

/**
 * Decodes an `aws-chunked` request body (`STREAMING-AWS4-HMAC-SHA256-PAYLOAD[-TRAILER]`,
 * `STREAMING-UNSIGNED-PAYLOAD-TRAILER`) into the plain object bytes, verifying every chunk signature (chained from
 * the request signature) and, with trailers, the trailer signature and a CRC32 / SHA-256 / SHA-1 checksum. Any
 * mismatch errors the stream, so the forwarded upstream request is aborted before the object is committed.
 */
export class AwsChunkedDecoder extends Transform {
  private buffer: Buffer = Buffer.alloc(0);
  private state: State = 'header';
  private remaining = 0;
  private chunkSignature: string | null = null;
  private chunkParts: Buffer[] = [];
  private previousSignature: string;
  private decoded = 0;
  private final = false;
  private readonly checksums = {
    crc32: 0,
    sha256: createHash('sha256'),
    sha1: createHash('sha1'),
  };

  constructor(
    private readonly request: Pick<VerifiedRequest, 'seedSignature' | 'signingKey' | 'scope' | 'amzDate'>,
    private readonly mode: { signed: boolean; trailer: boolean },
    /** `x-amz-decoded-content-length`: the object's size. */
    private readonly decodedLength: number,
  ) {
    super();
    this.previousSignature = request.seedSignature;
  }

  override _transform(data: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, data]) : data;

    try {
      this.drain();
      done();
    } catch (error) {
      done(error as Error);
    }
  }

  override _flush(done: TransformCallback): void {
    // Some clients end the last chunk without the closing blank line.
    const complete = this.state === 'done' || (this.state === 'data-crlf' && this.final && this.buffer.length === 0);

    if (!complete) return done(new ChunkedPayloadError('aws-chunked body ended early'));

    done();
  }

  private line(): string | null {
    const end = this.buffer.indexOf('\r\n');

    if (end < 0) {
      if (this.buffer.length > MAX_LINE) throw new ChunkedPayloadError('aws-chunked header line too long');

      return null;
    }

    const text = this.buffer.subarray(0, end).toString('latin1');

    this.buffer = this.buffer.subarray(end + 2);

    return text;
  }

  private drain(): void {
    for (;;) {
      switch (this.state) {
        case 'header': {
          const line = this.line();

          if (line === null) return;

          const match = /^([0-9a-fA-F]{1,16})(?:;chunk-signature=([0-9a-f]{64}))?$/.exec(line);

          if (!match) throw new ChunkedPayloadError('malformed aws-chunked header');

          if (this.mode.signed && !match[2]) throw new ChunkedPayloadError('chunk signature missing');

          this.remaining = parseInt(match[1], 16);

          if (this.remaining > MAX_CHUNK) throw new ChunkedPayloadError('aws-chunked chunk too large');

          this.chunkSignature = match[2] ?? null;
          this.chunkParts = [];

          if (this.remaining === 0) {
            this.verifyChunk(Buffer.alloc(0));
            this.final = true;

            if (this.decoded !== this.decodedLength)
              throw new ChunkedPayloadError('decoded length differs from x-amz-decoded-content-length');

            this.state = this.mode.trailer ? 'trailer' : 'data-crlf';
            continue;
          }

          this.state = 'data';
          continue;
        }
        case 'data': {
          if (this.buffer.length === 0) return;

          const take = Math.min(this.remaining, this.buffer.length);
          const piece = this.buffer.subarray(0, take);

          this.buffer = this.buffer.subarray(take);
          this.remaining -= take;
          this.chunkParts.push(piece);

          if (this.remaining > 0) return;

          const chunk = this.chunkParts.length === 1 ? this.chunkParts[0] : Buffer.concat(this.chunkParts);

          this.verifyChunk(chunk);
          this.decoded += chunk.length;

          if (this.decoded > this.decodedLength)
            throw new ChunkedPayloadError('body larger than x-amz-decoded-content-length');

          this.update(chunk);
          this.push(chunk);
          this.state = 'data-crlf';
          continue;
        }
        case 'data-crlf': {
          if (this.buffer.length < 2) return;

          if (this.buffer[0] !== 0x0d || this.buffer[1] !== 0x0a) throw new ChunkedPayloadError('missing CRLF');

          this.buffer = this.buffer.subarray(2);
          this.state = this.final ? 'done' : 'header';
          continue;
        }
        case 'trailer': {
          const end = this.buffer.indexOf('\r\n\r\n');

          if (end < 0) {
            if (this.buffer.length > MAX_TRAILER) throw new ChunkedPayloadError('trailer too long');

            return;
          }

          this.verifyTrailer(this.buffer.subarray(0, end).toString('latin1'));
          this.buffer = this.buffer.subarray(end + 4);
          this.state = 'done';
          continue;
        }
        case 'done':
          if (this.buffer.length > 0) throw new ChunkedPayloadError('data after the final chunk');

          return;
      }
    }
  }

  private verifyChunk(chunk: Buffer): void {
    if (!this.mode.signed) return;

    const expected = signatureHex(
      this.request.signingKey,
      chunkStringToSign(this.request.amzDate, this.request.scope, this.previousSignature, chunk),
    );

    if (!this.chunkSignature || !constantTimeEqualHex(expected, this.chunkSignature))
      throw new ChunkedPayloadError('chunk signature does not match');

    this.previousSignature = this.chunkSignature;
  }

  private update(chunk: Buffer): void {
    this.checksums.crc32 = crc32(chunk, this.checksums.crc32);
    this.checksums.sha256.update(chunk);
    this.checksums.sha1.update(chunk);
  }

  private verifyTrailer(section: string): void {
    const lines = section.split('\r\n').filter((l) => l.length > 0);
    const fields = new Map<string, string>();

    for (const line of lines) {
      const colon = line.indexOf(':');

      if (colon < 0) throw new ChunkedPayloadError('malformed trailer');

      fields.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
    }

    if (this.mode.signed) {
      const signature = fields.get('x-amz-trailer-signature');
      const signedPart =
        lines
          .filter((l) => !l.toLowerCase().startsWith('x-amz-trailer-signature:'))
          .map((l) => {
            const colon = l.indexOf(':');

            return `${l.slice(0, colon).trim().toLowerCase()}:${l.slice(colon + 1).trim()}`;
          })
          .join('\n') + '\n';
      const expected = signatureHex(
        this.request.signingKey,
        trailerStringToSign(this.request.amzDate, this.request.scope, this.previousSignature, signedPart),
      );

      if (!signature || !constantTimeEqualHex(expected, signature))
        throw new ChunkedPayloadError('trailer signature does not match');
    }

    const crc = fields.get('x-amz-checksum-crc32');
    const sha256 = fields.get('x-amz-checksum-sha256');
    const sha1 = fields.get('x-amz-checksum-sha1');
    const crcBytes = Buffer.alloc(4);

    crcBytes.writeUInt32BE(this.checksums.crc32 >>> 0);

    if (crc !== undefined && crc !== crcBytes.toString('base64'))
      throw new ChunkedPayloadError('x-amz-checksum-crc32 does not match');

    if (sha256 !== undefined && sha256 !== this.checksums.sha256.digest('base64'))
      throw new ChunkedPayloadError('x-amz-checksum-sha256 does not match');

    if (sha1 !== undefined && sha1 !== this.checksums.sha1.digest('base64'))
      throw new ChunkedPayloadError('x-amz-checksum-sha1 does not match');
  }
}
