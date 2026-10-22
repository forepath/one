import { FrameConnection } from './connection';
import { MICROVM_MAX_CONTROL_PAYLOAD, MICROVM_MAX_FRAME_PAYLOAD, MICROVM_STREAM_WINDOW } from './constants';
import {
  DataChannel,
  Frame,
  FrameDecoder,
  FrameType,
  decodeData,
  decodeJson,
  encodeData,
  encodeFrame,
  encodeWindow,
} from './frame';

function capture(): { connection: FrameConnection; sent: Frame[]; received: Frame[]; errors: Error[] } {
  const decoder = new FrameDecoder();
  const sent: Frame[] = [];
  const received: Frame[] = [];
  const errors: Error[] = [];
  const connection = new FrameConnection({
    write: (bytes) => sent.push(...decoder.push(bytes)),
    onFrame: (frame) => received.push(frame),
    onProtocolError: (error) => errors.push(error),
  });

  return { connection, sent, received, errors };
}

const dataBytes = (frames: Frame[]): number =>
  frames
    .filter((frame) => frame.type === FrameType.Data)
    .reduce((total, frame) => total + decodeData(frame.payload).data.length, 0);

describe('FrameConnection flow control', () => {
  it('stops at the window and resumes when the peer grants credit', () => {
    const { connection, sent } = capture();
    const resumed = jest.fn();

    connection.openOutbound(5);

    expect(connection.sendData(5, DataChannel.Stdout, Buffer.alloc(MICROVM_STREAM_WINDOW + 1000))).toBe(false);
    expect(dataBytes(sent)).toBe(MICROVM_STREAM_WINDOW);

    connection.whenWritable(5, resumed);
    connection.receive(encodeFrame(FrameType.Window, 5, encodeWindow(400)));

    expect(dataBytes(sent)).toBe(MICROVM_STREAM_WINDOW + 400);
    expect(resumed).not.toHaveBeenCalled();

    connection.receive(encodeFrame(FrameType.Window, 5, encodeWindow(MICROVM_STREAM_WINDOW)));

    expect(dataBytes(sent)).toBe(MICROVM_STREAM_WINDOW + 1000);
    expect(resumed).toHaveBeenCalledTimes(1);
  });

  it('passes window frames of foreign streams through (relay mode)', () => {
    const { connection, received } = capture();

    connection.receive(encodeFrame(FrameType.Window, 9, encodeWindow(10)));

    expect(received.map((frame) => [frame.type, frame.stream])).toEqual([[FrameType.Window, 9]]);
  });

  it('releases waiters when a stream closes and ignores data for unknown streams', () => {
    const { connection, sent } = capture();
    const resumed = jest.fn();

    connection.openOutbound(2);
    connection.sendData(2, DataChannel.Stdout, Buffer.alloc(MICROVM_STREAM_WINDOW * 2));
    connection.whenWritable(2, resumed);
    connection.closeOutbound(2);

    expect(resumed).toHaveBeenCalledTimes(1);
    expect(connection.sendData(3, DataChannel.Stdout, Buffer.from('x'))).toBe(true);
    expect(dataBytes(sent)).toBe(MICROVM_STREAM_WINDOW);
  });

  it('reports malformed input once and then ignores the transport', () => {
    const { connection, errors, received } = capture();
    const garbage = Buffer.alloc(9);

    garbage.writeUInt8(250, 4);
    connection.receive(garbage);
    connection.receive(encodeFrame(FrameType.Close, 1));

    expect(errors).toHaveLength(1);
    expect(received).toHaveLength(0);
  });

  it('splits large control messages into continuation frames and reassembles them', () => {
    const sender = capture();
    const receiver = capture();
    const env = Array.from({ length: 2000 }, (_, index) => `VAR_${index}=${'x'.repeat(100)}`);

    sender.connection.sendJson(FrameType.OpenExec, 4, { argv: ['id'], env });

    expect(sender.sent.length).toBeGreaterThan(1);
    expect(sender.sent.slice(0, -1).every((frame) => frame.type === FrameType.Continuation)).toBe(true);
    expect(sender.sent.every((frame) => frame.payload.length <= MICROVM_MAX_FRAME_PAYLOAD)).toBe(true);

    for (const frame of sender.sent) {
      receiver.connection.receive(encodeFrame(frame.type, frame.stream, frame.payload));
    }

    expect(receiver.received).toHaveLength(1);
    expect(receiver.received[0].type).toBe(FrameType.OpenExec);
    expect((decodeJson(receiver.received[0].payload) as { env: string[] }).env).toHaveLength(2000);
  });

  it('rejects oversized control messages and continuations before data', () => {
    const { connection, errors } = capture();

    expect(() => connection.sendJson(FrameType.Boot, 0, { blob: 'x'.repeat(MICROVM_MAX_CONTROL_PAYLOAD + 1) })).toThrow(
      /too large/,
    );

    connection.receive(encodeFrame(FrameType.Continuation, 3, Buffer.from('{')));
    connection.receive(encodeFrame(FrameType.Data, 3, encodeData(DataChannel.Stdout, Buffer.from('x'))));

    expect(errors[0].message).toMatch(/Continuation frames must precede/);
  });

  it('tears the connection down when the peer ignores the granted window (no unbounded buffering)', () => {
    const { connection, errors, received } = capture();
    const chunk = encodeData(DataChannel.Stdout, Buffer.alloc(MICROVM_MAX_FRAME_PAYLOAD - 1));

    for (let index = 0; index < 4; index += 1) {
      connection.receive(encodeFrame(FrameType.Data, 7, chunk));
    }

    expect(errors).toHaveLength(0);
    connection.grant(7, MICROVM_MAX_FRAME_PAYLOAD - 1);
    connection.receive(encodeFrame(FrameType.Data, 7, chunk));
    expect(errors).toHaveLength(0);
    connection.receive(encodeFrame(FrameType.Data, 7, chunk));

    expect(errors[0].message).toMatch(/exceeded its flow-control window/);
    expect(received).toHaveLength(5);
  });

  it('re-splits relayed control payloads and caps partial messages across streams', () => {
    const relay = capture();
    const big = Buffer.from(JSON.stringify({ message: 'x'.repeat(MICROVM_MAX_FRAME_PAYLOAD * 2) }));

    relay.connection.sendControl(FrameType.Error, 5, big);
    expect(relay.sent.map((frame) => frame.type)).toEqual([
      FrameType.Continuation,
      FrameType.Continuation,
      FrameType.Error,
    ]);

    const { connection, errors } = capture();
    const chunk = Buffer.alloc(MICROVM_MAX_FRAME_PAYLOAD);

    for (let stream = 1; errors.length === 0 && stream < 1000; stream += 1) {
      connection.receive(encodeFrame(FrameType.Continuation, stream, chunk));
    }

    expect(errors[0].message).toMatch(/Control message too large/);
  });
});
