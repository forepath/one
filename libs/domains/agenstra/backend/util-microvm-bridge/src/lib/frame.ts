import { MICROVM_MAX_FRAME_PAYLOAD } from './constants';

/** Frame types of the bridge protocol. Values are part of the wire format: never renumber. */
export enum FrameType {
  /**
   * both: leading part of a control message larger than one frame; the parts of a stream are concatenated with
   * the payload of the next non-continuation frame of that stream.
   */
  Continuation = 9,
  /** guest -> host, stream 0: `{ version }` once the guest agent opened its port. */
  Hello = 1,
  /** host -> guest, stream 0: workload configuration (JSON, see `BootConfig`). */
  Boot = 2,
  /** guest -> host, stream 0: the workload was started. */
  Ready = 3,
  /** host -> guest, stream 0: `{ graceSeconds }` stop the workload (SIGTERM, then SIGKILL). */
  Stop = 4,
  /** guest -> host, stream 0: `{ code }` the workload exited; the guest powers off afterwards. */
  WorkloadExit = 5,
  /** host -> guest: open an exec session (JSON, see `ExecRequest`). */
  OpenExec = 10,
  /** host -> guest: open a TCP connection to `127.0.0.1:<port>` inside the guest (JSON `{ port }`). */
  OpenTcp = 11,
  /** both: stream data; first payload byte is the channel (0 stdin/tcp, 1 stdout, 2 stderr). */
  Data = 20,
  /** both: end of a channel (payload: 1 byte channel). */
  Eof = 21,
  /** both: grant `u32` more bytes of flow-control window for the stream. */
  Window = 22,
  /** host -> guest: terminal size `u16 cols, u16 rows`. */
  Resize = 23,
  /** host -> guest: deliver a signal (payload: signal name, e.g. `SIGINT`). */
  Signal = 24,
  /** guest -> host: `{ code, signal }` exec session finished. */
  Exit = 25,
  /** both: `{ message }` stream failed. */
  Error = 26,
  /** both: stream fully closed (no further frames). */
  Close = 27,
}

export const FRAME_HEADER_SIZE = 9;

export interface Frame {
  type: FrameType;
  stream: number;
  payload: Buffer;
}

export class FrameProtocolError extends Error {}

const KNOWN_TYPES = new Set<number>(
  Object.values(FrameType).filter((value): value is number => typeof value === 'number'),
);

export function encodeFrame(type: FrameType, stream: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  if (payload.length > MICROVM_MAX_FRAME_PAYLOAD) {
    throw new FrameProtocolError(`Frame payload too large (${payload.length} bytes)`);
  }

  if (!Number.isInteger(stream) || stream < 0 || stream > 0xffffffff) {
    throw new FrameProtocolError(`Invalid stream id ${stream}`);
  }

  const header = Buffer.alloc(FRAME_HEADER_SIZE);

  header.writeUInt32BE(payload.length, 0);
  header.writeUInt8(type, 4);
  header.writeUInt32BE(stream, 5);

  return Buffer.concat([header, payload]);
}

/** Incremental decoder: feed arbitrary chunks, get complete frames. Throws on malformed input. */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Frame[] {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const frames: Frame[] = [];

    while (this.buffer.length >= FRAME_HEADER_SIZE) {
      const length = this.buffer.readUInt32BE(0);
      const type = this.buffer.readUInt8(4);

      if (length > MICROVM_MAX_FRAME_PAYLOAD) {
        throw new FrameProtocolError(`Frame payload too large (${length} bytes)`);
      }

      if (!KNOWN_TYPES.has(type)) {
        throw new FrameProtocolError(`Unknown frame type ${type}`);
      }

      if (this.buffer.length < FRAME_HEADER_SIZE + length) {
        break;
      }

      frames.push({
        type,
        stream: this.buffer.readUInt32BE(5),
        payload: this.buffer.subarray(FRAME_HEADER_SIZE, FRAME_HEADER_SIZE + length),
      });
      this.buffer = this.buffer.subarray(FRAME_HEADER_SIZE + length);
    }

    if (!this.buffer.length) {
      this.buffer = Buffer.alloc(0);
    } else {
      this.buffer = Buffer.from(this.buffer);
    }

    return frames;
  }
}

export enum DataChannel {
  Stdin = 0,
  Stdout = 1,
  Stderr = 2,
}

export function encodeData(channel: DataChannel, data: Buffer): Buffer {
  return Buffer.concat([Buffer.from([channel]), data]);
}

export function decodeData(payload: Buffer): { channel: DataChannel; data: Buffer } {
  if (payload.length < 1 || payload[0] > DataChannel.Stderr) {
    throw new FrameProtocolError('Malformed data frame');
  }

  return { channel: payload[0] as DataChannel, data: payload.subarray(1) };
}

export function encodeWindow(bytes: number): Buffer {
  const payload = Buffer.alloc(4);

  payload.writeUInt32BE(bytes, 0);

  return payload;
}

export function decodeWindow(payload: Buffer): number {
  if (payload.length !== 4) {
    throw new FrameProtocolError('Malformed window frame');
  }

  return payload.readUInt32BE(0);
}

export function encodeResize(cols: number, rows: number): Buffer {
  const payload = Buffer.alloc(4);

  payload.writeUInt16BE(clampTerminalDimension(cols), 0);
  payload.writeUInt16BE(clampTerminalDimension(rows), 2);

  return payload;
}

export function decodeResize(payload: Buffer): { cols: number; rows: number } {
  if (payload.length !== 4) {
    throw new FrameProtocolError('Malformed resize frame');
  }

  return {
    cols: clampTerminalDimension(payload.readUInt16BE(0)),
    rows: clampTerminalDimension(payload.readUInt16BE(2)),
  };
}

export function clampTerminalDimension(value: number): number {
  if (!Number.isFinite(value)) {
    return 80;
  }

  return Math.min(Math.max(Math.trunc(value), 1), 1000);
}

export function encodeJson(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

export function decodeJson(payload: Buffer): unknown {
  try {
    return JSON.parse(payload.toString('utf8')) as unknown;
  } catch {
    throw new FrameProtocolError('Malformed JSON frame');
  }
}
