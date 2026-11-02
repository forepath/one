/** Bytes kept per recording (encoded); beyond that the cast notes the truncation (3.19). */
export const MAX_RECORDING_BYTES = 50 * 1024 * 1024;
/** Recordings of all sessions on one replica together; beyond that new output isn't recorded. */
export const MAX_TOTAL_RECORDING_BYTES = 256 * 1024 * 1024;

let totalBytes = 0;

/**
 * An asciicast v2 recording (3.19): a header line, then `[seconds, "o", text]` per output chunk. Kept in memory while
 * the session runs and stored when it ends; sizes count the encoded lines, within a per-replica budget.
 */
export class AsciicastRecorder {
  private readonly lines: Buffer[] = [];
  private bytes = 0;
  private truncated = false;

  constructor(
    private readonly startedAt: number,
    cols: number,
    rows: number,
    title: string,
  ) {
    this.push(
      `${JSON.stringify({ version: 2, width: cols, height: rows, timestamp: Math.floor(startedAt / 1000), title })}\n`,
    );
  }

  static get totalBytes(): number {
    return totalBytes;
  }

  private push(line: string): void {
    const buffer = Buffer.from(line);

    this.lines.push(buffer);
    this.bytes += buffer.length;
    totalBytes += buffer.length;
  }

  private add(at: number, type: 'o' | 'r', text: string): void {
    if (this.truncated) return;

    const line = `${JSON.stringify([(at - this.startedAt) / 1000, type, text])}\n`;
    const size = Buffer.byteLength(line);

    if (this.bytes + size > MAX_RECORDING_BYTES || totalBytes + size > MAX_TOTAL_RECORDING_BYTES) {
      this.truncated = true;
      this.push(`${JSON.stringify([(at - this.startedAt) / 1000, 'o', '\r\n[recording truncated]\r\n'])}\n`);

      return;
    }

    this.push(line);
  }

  output(text: string, at = Date.now()): void {
    this.add(at, 'o', text);
  }

  resize(cols: number, rows: number, at = Date.now()): void {
    this.add(at, 'r', `${cols}x${rows}`);
  }

  /** The cast; the recorder is empty afterwards (its budget released). */
  take(): Buffer {
    const buffer = Buffer.concat(this.lines);

    this.dispose();

    return buffer;
  }

  dispose(): void {
    totalBytes -= this.bytes;
    this.bytes = 0;
    this.lines.length = 0;
    this.truncated = true;
  }
}
