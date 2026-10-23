import {
  agentMessage,
  type Envelope,
  type Probe,
  type ProbeResults,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable, OnModuleDestroy } from '@nestjs/common';

import { runProbe } from './probe-runner';

const TICK_MS = 1_000;
const REPORT_MS = 5_000;

/** Runs the node's probes on their intervals and reports results to the control plane in batches (3.28). */
@Injectable()
export class ProbeManager implements OnModuleDestroy {
  private probes: Probe[] = [];
  private readonly due = new Map<string, number>();
  private readonly running = new Set<string>();
  private results: ProbeResults['results'] = [];
  private send: ((envelope: Envelope) => void) | null = null;
  private timers: NodeJS.Timeout[] = [];

  attach(send: (envelope: Envelope) => void): void {
    this.send = send;

    if (this.timers.length === 0) {
      this.timers.push(
        setInterval(() => this.tick(), TICK_MS),
        setInterval(() => this.report(), REPORT_MS),
      );
    }
  }

  apply(probes: Probe[] = []): void {
    const ids = new Set(probes.map((p) => p.id));

    for (const id of [...this.due.keys()]) if (!ids.has(id)) this.due.delete(id);

    this.probes = probes;
  }

  /** Starts every probe that is due; a probe never overlaps itself. */
  tick(now = Date.now()): void {
    for (const probe of this.probes) {
      if (this.running.has(probe.id) || (this.due.get(probe.id) ?? 0) > now) continue;

      this.due.set(probe.id, now + probe.intervalSeconds * 1000);
      this.running.add(probe.id);
      void runProbe(probe)
        .then((outcome) => this.results.push({ id: probe.id, ...outcome }))
        .finally(() => this.running.delete(probe.id));
    }
  }

  report(): void {
    if (!this.send || this.results.length === 0) return;

    const batch = this.results.splice(0, 1024);

    this.send(agentMessage('probeResults', { results: batch }));
  }

  onModuleDestroy(): void {
    this.timers.forEach((t) => clearInterval(t));
  }
}
