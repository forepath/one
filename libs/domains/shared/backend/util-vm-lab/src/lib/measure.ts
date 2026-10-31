import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Measurements and verdicts of lab runs (boot times, freezes, memory): printed as they happen (`[vm-lab] …` on
 * stderr) and written as one JSON file per suite into `VM_LAB_RESULTS_DIR` (default `<tmp>/vm-lab/results`), so the
 * gate can collect them after the run.
 */

export interface Measurement {
  name: string;
  value: number;
  unit: string;
  /** What it is checked against (budget), if anything. */
  budget?: number;
  at: string;
}

export interface Verdict {
  check: string;
  pass: boolean;
  detail: string;
  at: string;
}

export function resultsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env['VM_LAB_RESULTS_DIR'] ?? join(tmpdir(), 'vm-lab', 'results');
}

export function formatMeasurement(m: Pick<Measurement, 'name' | 'value' | 'unit' | 'budget'>): string {
  const value = Number.isInteger(m.value) ? String(m.value) : m.value.toFixed(2);
  const budget =
    m.budget === undefined ? '' : ` (budget ${m.budget} ${m.unit}: ${m.value <= m.budget ? 'within' : 'OVER'})`;

  return `${m.name} = ${value} ${m.unit}${budget}`;
}

export function formatVerdict(v: Pick<Verdict, 'check' | 'pass' | 'detail'>): string {
  return `${v.pass ? 'PASS' : 'FAIL'} ${v.check}${v.detail ? ` — ${v.detail}` : ''}`;
}

export class LabRecorder {
  readonly measurements: Measurement[] = [];
  readonly verdicts: Verdict[] = [];
  readonly notes: Record<string, unknown> = {};

  constructor(
    readonly suite: string,
    private readonly write: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
  ) {}

  measure(name: string, value: number, unit: string, budget?: number): number {
    const m = { name, value, unit, budget, at: new Date().toISOString() };

    this.measurements.push(m);
    this.write(`[vm-lab] ${this.suite}: ${formatMeasurement(m)}`);

    return value;
  }

  /** Measures the duration of `fn` in seconds (one decimal). */
  async time<T>(name: string, fn: () => Promise<T>, budgetSeconds?: number): Promise<T> {
    const start = Date.now();
    const result = await fn();

    this.measure(name, Math.round((Date.now() - start) / 100) / 10, 's', budgetSeconds);

    return result;
  }

  note(name: string, value: unknown): void {
    this.notes[name] = value;
    this.write(`[vm-lab] ${this.suite}: ${name}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  }

  verdict(check: string, pass: boolean, detail = ''): boolean {
    const v = { check, pass, detail, at: new Date().toISOString() };

    this.verdicts.push(v);
    this.write(`[vm-lab] ${this.suite}: ${formatVerdict(v)}`);

    return pass;
  }

  summary(): string {
    return [
      `== ${this.suite} ==`,
      ...this.verdicts.map(formatVerdict),
      ...this.measurements.map(formatMeasurement),
      ...Object.entries(this.notes).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`),
    ].join('\n');
  }

  /** Prints the summary and writes `<results>/<suite>-<timestamp>.json`; returns the file. */
  flush(dir = resultsDir()): string {
    const file = join(dir, `${this.suite.replace(/[^A-Za-z0-9_.-]+/g, '-')}-${Date.now()}.json`);

    mkdirSync(dir, { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify({ suite: this.suite, measurements: this.measurements, verdicts: this.verdicts, notes: this.notes }, null, 2)}\n`,
    );
    this.write(`${this.summary()}\n(results: ${file})`);

    return file;
  }
}
