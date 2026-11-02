import { TokenBucket } from './rate.utils';
import { AsciicastRecorder, MAX_RECORDING_BYTES } from './recording.utils';

describe('AsciicastRecorder', () => {
  it('records output and resizes as asciicast v2', () => {
    const recorder = new AsciicastRecorder(1_000, 80, 24, 'replica/shop/site/web/0');

    recorder.output('hi\r\n', 1_500);
    recorder.resize(100, 30, 2_000);

    const lines = recorder.take().toString().trim().split('\n');

    expect(JSON.parse(lines[0])).toMatchObject({ version: 2, width: 80, height: 24 });
    expect(JSON.parse(lines[1])).toEqual([0.5, 'o', 'hi\r\n']);
    expect(JSON.parse(lines[2])).toEqual([1, 'r', '100x30']);
    expect(AsciicastRecorder.totalBytes).toBe(0);
  });

  it('counts encoded bytes: control characters cannot exceed the cap', () => {
    const recorder = new AsciicastRecorder(0, 80, 24, 't');
    // Each \x01 encodes as \u0001 (6 bytes): 10 MB of them would be 60 MB encoded.
    const chunk = '\x01'.repeat(1024 * 1024);

    for (let i = 0; i < 10; i++) recorder.output(chunk, i);

    const cast = recorder.take();

    expect(cast.length).toBeLessThanOrEqual(MAX_RECORDING_BYTES + 1024);
    expect(cast.toString()).toContain('[recording truncated]');
  });
});

describe('TokenBucket', () => {
  it('allows bursts and refills at its rate', () => {
    const bucket = new TokenBucket(100, 200, 0);

    expect(bucket.take(200, 0)).toBe(true);
    expect(bucket.take(1, 0)).toBe(false);
    expect(bucket.take(50, 500)).toBe(true);
    expect(bucket.take(1, 500)).toBe(false);
    expect(bucket.take(200, 10_000)).toBe(true);
  });
});
