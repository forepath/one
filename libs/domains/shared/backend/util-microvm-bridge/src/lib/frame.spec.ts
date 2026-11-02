import { MICROVM_MAX_FRAME_PAYLOAD } from './constants';
import {
  DataChannel,
  FRAME_HEADER_SIZE,
  FrameDecoder,
  FrameProtocolError,
  FrameType,
  decodeData,
  decodeJson,
  decodeResize,
  decodeWindow,
  encodeData,
  encodeFrame,
  encodeJson,
  encodeResize,
  encodeWindow,
} from './frame';

describe('bridge frames', () => {
  it('round-trips frames split across arbitrary chunks', () => {
    const bytes = Buffer.concat([
      encodeFrame(FrameType.Hello, 0, encodeJson({ version: 1 })),
      encodeFrame(FrameType.Data, 7, encodeData(DataChannel.Stdout, Buffer.from('hello'))),
      encodeFrame(FrameType.Close, 7),
    ]);
    const decoder = new FrameDecoder();
    const frames = [];

    for (let offset = 0; offset < bytes.length; offset += 3) {
      frames.push(...decoder.push(bytes.subarray(offset, offset + 3)));
    }

    expect(frames.map((frame) => [frame.type, frame.stream])).toEqual([
      [FrameType.Hello, 0],
      [FrameType.Data, 7],
      [FrameType.Close, 7],
    ]);
    expect(decodeJson(frames[0].payload)).toEqual({ version: 1 });
    expect(decodeData(frames[1].payload)).toEqual({ channel: DataChannel.Stdout, data: Buffer.from('hello') });
    expect(frames[2].payload).toHaveLength(0);
  });

  it('rejects oversized payloads on both sides', () => {
    expect(() => encodeFrame(FrameType.Data, 1, Buffer.alloc(MICROVM_MAX_FRAME_PAYLOAD + 1))).toThrow(
      FrameProtocolError,
    );

    const header = Buffer.alloc(FRAME_HEADER_SIZE);

    header.writeUInt32BE(MICROVM_MAX_FRAME_PAYLOAD + 1, 0);
    header.writeUInt8(FrameType.Data, 4);

    expect(() => new FrameDecoder().push(header)).toThrow(/too large/);
  });

  it('rejects unknown frame types and invalid stream ids', () => {
    const header = Buffer.alloc(FRAME_HEADER_SIZE);

    header.writeUInt8(99, 4);

    expect(() => new FrameDecoder().push(header)).toThrow(/Unknown frame type/);
    expect(() => encodeFrame(FrameType.Close, -1)).toThrow(/Invalid stream id/);
  });

  it('encodes windows, resizes and data channels', () => {
    expect(decodeWindow(encodeWindow(4096))).toBe(4096);
    expect(decodeResize(encodeResize(120, 40))).toEqual({ cols: 120, rows: 40 });
    expect(decodeResize(encodeResize(0, 5000))).toEqual({ cols: 1, rows: 1000 });
    expect(() => decodeData(Buffer.from([9]))).toThrow(/Malformed data frame/);
    expect(() => decodeWindow(Buffer.alloc(2))).toThrow(/Malformed window frame/);
    expect(() => decodeJson(Buffer.from('{'))).toThrow(/Malformed JSON frame/);
  });
});
