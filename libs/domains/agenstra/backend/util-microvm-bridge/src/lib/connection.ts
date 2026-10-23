import { MICROVM_MAX_CONTROL_PAYLOAD, MICROVM_MAX_FRAME_PAYLOAD, MICROVM_STREAM_WINDOW } from './constants';
import {
  DataChannel,
  Frame,
  FrameDecoder,
  FrameProtocolError,
  FrameType,
  decodeWindow,
  encodeData,
  encodeFrame,
  encodeJson,
  encodeWindow,
} from './frame';

interface OutboundWindow {
  credit: number;
  queue: { channel: DataChannel; data: Buffer }[];
  waiters: (() => void)[];
}

export interface FrameConnectionOptions {
  /** Writes encoded bytes to the transport. */
  write: (bytes: Buffer) => void;
  /** Every decoded frame except WINDOW frames of streams this connection sends flow-controlled data on. */
  onFrame: (frame: Frame) => void;
  /** Malformed input: the connection must be torn down (the decoder state is undefined afterwards). */
  onProtocolError: (error: Error) => void;
}

/**
 * One side of a bridge transport (virtio-serial port or exec-client socket): frame decoding plus per-stream
 * credit-based flow control. Streams that send data through `sendData` own an outbound window; WINDOW frames
 * for them are consumed here. WINDOW frames of other streams are passed to `onFrame`, so a relay (the launcher
 * daemon) forwards credits end to end instead of absorbing them.
 *
 * The peer is not trusted: inbound data beyond the window this side granted (directly or relayed), oversized
 * reassembled control messages and malformed frames end the connection through `onProtocolError`, so a peer that
 * ignores flow control can never make this side buffer without bound.
 */
export class FrameConnection {
  private readonly decoder = new FrameDecoder();
  private readonly windows = new Map<number, OutboundWindow>();
  /** Inbound data bytes per stream that this side has not granted back yet. */
  private readonly inbound = new Map<number, number>();
  /** Leading parts of control messages split into continuation frames (bounded in total, not only per stream). */
  private readonly partials = new Map<number, { parts: Buffer[]; size: number }>();
  private partialBytes = 0;
  private failed = false;

  constructor(private readonly options: FrameConnectionOptions) {}

  receive(chunk: Buffer): void {
    if (this.failed) {
      return;
    }

    let frames: Frame[];

    try {
      frames = this.decoder.push(chunk);
    } catch (error) {
      this.failed = true;
      this.options.onProtocolError(error as Error);

      return;
    }

    for (const received of frames) {
      if (this.failed) {
        return;
      }

      try {
        const frame = this.reassemble(received);

        if (!frame) {
          continue;
        }

        if (frame.type === FrameType.Data) {
          this.accountInbound(frame.stream, frame.payload.length - 1);
        }

        if (frame.type === FrameType.Window && this.windows.has(frame.stream)) {
          this.addCredit(frame.stream, decodeWindow(frame.payload));
          continue;
        }

        if (frame.type === FrameType.Close) {
          this.inbound.delete(frame.stream);
        }

        this.options.onFrame(frame);
      } catch (error) {
        this.failed = true;
        this.options.onProtocolError(error as Error);

        return;
      }
    }
  }

  private reassemble(frame: Frame): Frame | null {
    const partial = this.partials.get(frame.stream);

    if (frame.type === FrameType.Continuation) {
      const next = partial ?? { parts: [], size: 0 };

      next.parts.push(Buffer.from(frame.payload));
      next.size += frame.payload.length;
      this.partialBytes += frame.payload.length;

      if (next.size > MICROVM_MAX_CONTROL_PAYLOAD || this.partialBytes > MICROVM_MAX_CONTROL_PAYLOAD) {
        throw new FrameProtocolError('Control message too large');
      }

      this.partials.set(frame.stream, next);

      return null;
    }

    if (!partial) {
      return frame;
    }

    this.partials.delete(frame.stream);
    this.partialBytes -= partial.size;

    if (frame.type === FrameType.Data || frame.type === FrameType.Window) {
      throw new FrameProtocolError('Continuation frames must precede a control message');
    }

    return { ...frame, payload: Buffer.concat([...partial.parts, frame.payload]) };
  }

  private accountInbound(stream: number, bytes: number): void {
    const outstanding = (this.inbound.get(stream) ?? 0) + Math.max(bytes, 0);

    if (outstanding > MICROVM_STREAM_WINDOW) {
      throw new FrameProtocolError(`Stream ${stream} exceeded its flow-control window`);
    }

    this.inbound.set(stream, outstanding);
  }

  send(type: FrameType, stream: number, payload?: Buffer): void {
    if (type === FrameType.Window && payload) {
      // Credits granted here (or relayed from the consumer behind a relay) allow the peer to send more.
      const outstanding = (this.inbound.get(stream) ?? 0) - decodeWindow(payload);

      this.inbound.set(stream, Math.max(outstanding, 0));
    }

    if (type === FrameType.Close) {
      this.inbound.delete(stream);
    }

    this.options.write(encodeFrame(type, stream, payload));
  }

  /** Control message; payloads above one frame are split into continuation frames. */
  sendJson(type: FrameType, stream: number, value: unknown): void {
    this.sendControl(type, stream, encodeJson(value));
  }

  /**
   * Forward a (reassembled) control payload as is, split into continuation frames when it exceeds one frame
   * (used by the relay, which must not re-encode the peer's message).
   */
  sendControl(type: FrameType, stream: number, payload: Buffer): void {
    if (payload.length > MICROVM_MAX_CONTROL_PAYLOAD) {
      throw new FrameProtocolError(`Control message too large (${payload.length} bytes)`);
    }

    let offset = 0;

    while (payload.length - offset > MICROVM_MAX_FRAME_PAYLOAD) {
      this.send(FrameType.Continuation, stream, payload.subarray(offset, offset + MICROVM_MAX_FRAME_PAYLOAD));
      offset += MICROVM_MAX_FRAME_PAYLOAD;
    }

    this.send(type, stream, payload.subarray(offset));
  }

  /** Start sending flow-controlled data on `stream` (initial credit: one window). */
  openOutbound(stream: number): void {
    if (!this.windows.has(stream)) {
      this.windows.set(stream, { credit: MICROVM_STREAM_WINDOW, queue: [], waiters: [] });
    }
  }

  closeOutbound(stream: number): void {
    const window = this.windows.get(stream);

    this.windows.delete(stream);
    this.inbound.delete(stream);
    window?.waiters.splice(0).forEach((waiter) => waiter());
  }

  /**
   * Queue `data` on `stream` within the receiver's window. Returns `false` when data is waiting for credit; the
   * caller should pause its source and resume in `whenWritable`.
   */
  sendData(stream: number, channel: DataChannel, data: Buffer): boolean {
    const window = this.windows.get(stream);

    if (!window) {
      return true;
    }

    if (data.length) {
      window.queue.push({ channel, data });
    }

    this.flush(stream, window);

    return window.queue.length === 0;
  }

  /** Resolves `callback` once the stream's queued data was sent (or the stream was closed). */
  whenWritable(stream: number, callback: () => void): void {
    const window = this.windows.get(stream);

    if (!window || window.queue.length === 0) {
      callback();

      return;
    }

    window.waiters.push(callback);
  }

  /** Tell the peer that `bytes` of received data were consumed. */
  grant(stream: number, bytes: number): void {
    if (bytes > 0 && !this.failed) {
      this.send(FrameType.Window, stream, encodeWindow(bytes));
    }
  }

  private addCredit(stream: number, bytes: number): void {
    const window = this.windows.get(stream);

    if (!window) {
      return;
    }

    window.credit = Math.min(window.credit + bytes, MICROVM_STREAM_WINDOW * 4);
    this.flush(stream, window);
  }

  private flush(stream: number, window: OutboundWindow): void {
    while (window.queue.length && window.credit > 0) {
      const head = window.queue[0];
      const size = Math.min(head.data.length, window.credit, MICROVM_MAX_FRAME_PAYLOAD - 1);

      this.send(FrameType.Data, stream, encodeData(head.channel, head.data.subarray(0, size)));
      window.credit -= size;

      if (size === head.data.length) {
        window.queue.shift();
      } else {
        head.data = head.data.subarray(size);
      }
    }

    if (!window.queue.length) {
      window.waiters.splice(0).forEach((waiter) => waiter());
    }
  }
}
