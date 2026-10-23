/**
 * A WebSocket-like channel for noVNC (`new RFB(target, channel)`): noVNC accepts any object with `send`, `close`,
 * `binaryType`, `onopen`, `onmessage`, `onclose`, `onerror`, `protocol` and `readyState` (WebSocket or
 * RTCDataChannel semantics). {@link FpcVncChannelAdapter} implements it over any transport (Socket.IO events, a
 * relay, a test double): the transport calls `opened()` / `deliver()` / `closed()` / `failed()`, and the adapter
 * hands noVNC's outgoing RFB bytes to `send`.
 */
export type FpcVncReadyState = 'connecting' | 'open' | 'closing' | 'closed';

export interface FpcVncChannel {
  binaryType: string;
  protocol: string;
  readyState: FpcVncReadyState;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: ArrayBuffer | ArrayBufferView): void;
  close(): void;
}

export interface FpcVncTransport {
  /** Outgoing RFB bytes (a copy: noVNC reuses its send buffer). */
  send(data: ArrayBuffer): void;
  /** noVNC (or the viewer) closes the channel: end the remote session. */
  close(): void;
}

function toArrayBuffer(data: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data.slice(0);

  const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const copy = new Uint8Array(view.byteLength);

  copy.set(view);

  return copy.buffer;
}

export class FpcVncChannelAdapter implements FpcVncChannel {
  binaryType = 'arraybuffer';
  protocol = '';
  readyState: FpcVncReadyState = 'connecting';
  onopen: FpcVncChannel['onopen'] = null;
  onmessage: FpcVncChannel['onmessage'] = null;
  onclose: FpcVncChannel['onclose'] = null;
  onerror: FpcVncChannel['onerror'] = null;
  /** Bytes that arrived before noVNC attached its handlers (delivered on attach via `opened`). */
  private backlog: ArrayBuffer[] = [];

  constructor(private readonly transport: FpcVncTransport) {}

  send(data: ArrayBuffer | ArrayBufferView): void {
    if (this.readyState !== 'open') return;

    this.transport.send(toArrayBuffer(data));
  }

  close(): void {
    if (this.readyState === 'closed' || this.readyState === 'closing') return;

    this.readyState = 'closing';
    this.transport.close();
    this.closed(1000, 'closed');
  }

  /** The remote session is open (RFB bytes may flow). */
  opened(): void {
    if (this.readyState !== 'connecting') return;

    this.readyState = 'open';
    this.onopen?.({ type: 'open' });
    this.flush();
  }

  /** Incoming RFB bytes. */
  deliver(data: ArrayBuffer | ArrayBufferView): void {
    if (this.readyState === 'closed') return;

    const buffer = toArrayBuffer(data);

    if (this.readyState !== 'open' || !this.onmessage) {
      this.backlog.push(buffer);

      return;
    }

    this.flush();
    this.onmessage({ data: buffer });
  }

  /** The remote session ended. */
  closed(code = 1000, reason = ''): void {
    if (this.readyState === 'closed') return;

    this.readyState = 'closed';
    this.backlog = [];
    this.onclose?.({ code, reason, wasClean: code === 1000 });
  }

  /** A transport error: reported to noVNC, then the channel closes. */
  failed(message: string): void {
    if (this.readyState === 'closed') return;

    this.onerror?.({ type: 'error', message });
    this.closed(1006, message);
  }

  private flush(): void {
    if (!this.onmessage) return;

    const pending = this.backlog;

    this.backlog = [];

    for (const data of pending) this.onmessage({ data });
  }
}
