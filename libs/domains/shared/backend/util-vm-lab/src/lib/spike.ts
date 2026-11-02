import { LabRecorder } from './measure';

/**
 * Spikes (M7 "Risks and spikes" S1–S10): each one states the design decision it validates and what to change when it
 * fails, prints that before it runs and a PASS / FAIL summary with its measurements at the end.
 */

export const SPIKE_IDS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10'] as const;
export type SpikeId = (typeof SPIKE_IDS)[number];

export interface SpikeDefinition {
  id: SpikeId;
  title: string;
  /** The design decision (M7 design section) this spike validates. */
  validates: string;
  /** What to change in the design / code when it fails. */
  ifFails: string;
}

export function spikeBanner(spike: SpikeDefinition): string {
  return [
    `==== spike ${spike.id}: ${spike.title} ====`,
    `validates: ${spike.validates}`,
    `if it fails: ${spike.ifFails}`,
  ].join('\n');
}

/** Overall result: PASS when every verdict passed and there was at least one. */
export function spikeResult(recorder: Pick<LabRecorder, 'verdicts'>): 'PASS' | 'FAIL' | 'NO VERDICT' {
  if (recorder.verdicts.length === 0) return 'NO VERDICT';

  return recorder.verdicts.every((v) => v.pass) ? 'PASS' : 'FAIL';
}

/** A recorder for the spike that prints the banner now and the decision hint with the result at the end. */
export class SpikeRecorder extends LabRecorder {
  constructor(
    readonly spike: SpikeDefinition,
    write?: (line: string) => void,
  ) {
    super(`spike-${spike.id}`, write);
    (write ?? ((line: string) => process.stderr.write(`${line}\n`)))(spikeBanner(spike));
  }

  override summary(): string {
    const result = spikeResult(this);

    return [
      super.summary(),
      `spike ${this.spike.id} result: ${result}`,
      ...(result === 'PASS' ? [] : [`→ ${this.spike.ifFails}`]),
    ].join('\n');
  }
}
