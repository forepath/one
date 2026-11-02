import { GuestStats } from './messages';

/** Cumulative CPU counters of `/proc/stat` (jiffies), kept between two samples to compute the steal ratio. */
export interface CpuSample {
  total: number;
  steal: number;
}

function meminfoBytes(meminfo: string, field: string): number | null {
  const match = new RegExp(`^${field}:\\s+(\\d+)\\s*kB`, 'm').exec(meminfo);

  return match ? Number(match[1]) * 1024 : null;
}

/** Parses the aggregate `cpu` line of `/proc/stat` (user nice system idle iowait irq softirq steal …). */
export function parseCpuSample(stat: string): CpuSample | null {
  const line = stat.split('\n').find((entry) => entry.startsWith('cpu '));

  if (!line) {
    return null;
  }

  const values = line
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((value) => Number(value));

  if (values.length < 8 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  // guest / guest_nice (fields 9 and 10) are already included in user / nice.
  return { total: values.slice(0, 8).reduce((sum, value) => sum + value, 0), steal: values[7] };
}

/**
 * Guest accounting for the `STATS` message from `/proc/meminfo`, `/proc/stat` and `/proc/loadavg`. The steal ratio
 * covers the time since `previous` (0 for the first sample).
 */
export function computeGuestStats(
  files: { meminfo: string; stat: string; loadavg: string },
  previous: CpuSample | null,
): { stats: GuestStats; sample: CpuSample | null } {
  const memTotal = meminfoBytes(files.meminfo, 'MemTotal') ?? 0;
  const memAvailable = meminfoBytes(files.meminfo, 'MemAvailable') ?? meminfoBytes(files.meminfo, 'MemFree') ?? 0;
  const sample = parseCpuSample(files.stat);
  let cpuSteal = 0;

  if (sample && previous && sample.total > previous.total) {
    cpuSteal = Math.min(Math.max((sample.steal - previous.steal) / (sample.total - previous.total), 0), 1);
  }

  const load1 = Number(files.loadavg.trim().split(/\s+/)[0]);

  return {
    stats: {
      memTotal,
      memAvailable: Math.min(memAvailable, memTotal),
      cpuSteal: Math.round(cpuSteal * 10_000) / 10_000,
      load1: Number.isFinite(load1) && load1 >= 0 ? load1 : 0,
    },
    sample,
  };
}
