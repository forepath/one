import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, input } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import type { ContainerStatsEntry } from '@forepath/agenstra/frontend/data-access-agent-console';
import { StatsFacade } from '@forepath/agenstra/frontend/data-access-agent-console';
import { combineLatest, map, switchMap } from 'rxjs';

@Component({
  selector: 'framework-container-stats-status-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './container-stats-status-bar.component.html',
  styleUrls: ['./container-stats-status-bar.component.scss'],
})
export class ContainerStatsStatusBarComponent {
  private readonly statsFacade = inject(StatsFacade);
  private readonly destroyRef = inject(DestroyRef);

  clientId = input.required<string>();
  agentId = input.required<string>();

  // Get current stats - combine clientId and agentId observables
  private readonly clientId$ = toObservable(this.clientId);
  private readonly agentId$ = toObservable(this.agentId);

  // Get current stats and compute values
  readonly statsWithPrevious$ = combineLatest([this.clientId$, this.agentId$]).pipe(
    switchMap(([clientId, agentId]) =>
      combineLatest([
        this.statsFacade.getCurrentContainerStats$(clientId, agentId),
        this.statsFacade.getContainerStats$(clientId, agentId),
      ]).pipe(
        map(([current, statsArray]) => {
          if (!current || current.stats == null) {
            return {
              current: current ?? null,
              previous: null,
              cpuPercent: 0,
              memoryUsage: 0,
              memoryUsageFormatted: '0 B',
              memoryLimit: 0,
              memoryLimitFormatted: '0 B',
              memoryUsagePercent: 0,
            };
          }

          // Get previous entry for CPU calculation
          const previous = statsArray.length > 1 ? statsArray[statsArray.length - 2] : null;
          // Calculate CPU percent once here, not in template
          const cpuPercent = this.calculateCpuPercent(current, previous);
          // Calculate memory values once here, not in template (stats is defined here)
          const memoryUsage = current.stats.memory_stats?.usage || 0;
          const memoryLimit = this.getMemoryLimit(current.stats.memory_stats);
          const memoryUsagePercent = this.getMemoryUsagePercentage({
            memory_usage: memoryUsage,
            memory_limit: memoryLimit,
          });

          return {
            current,
            previous,
            cpuPercent,
            memoryUsage,
            memoryUsageFormatted: this.formatBytes(memoryUsage),
            memoryLimit,
            memoryLimitFormatted: this.formatBytes(memoryLimit),
            memoryUsagePercent,
          };
        }),
      ),
    ),
    takeUntilDestroyed(this.destroyRef),
  );

  // Expose current stats for template (backwards compatibility)
  readonly currentStats$ = this.statsWithPrevious$.pipe(map(({ current }) => current));

  /**
   * Format bytes to human-readable format
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Calculate CPU usage percentage from Docker stats
   * Uses precpu_stats from current entry, or falls back to previous entry's cpu_stats if missing
   * Based on the same calculation as agents.gateway.ts
   */
  calculateCpuPercent(currentEntry: ContainerStatsEntry | null, previousEntry: ContainerStatsEntry | null): number {
    // Validate current entry has required data
    if (!currentEntry?.stats?.cpu_stats) {
      return 0;
    }

    const currentCpu = currentEntry.stats.cpu_stats;

    if (!currentCpu?.cpu_usage?.total_usage || !currentCpu?.system_cpu_usage) {
      return 0;
    }

    // Get previous CPU stats - prefer precpu_stats from current entry, fallback to previous entry
    const prevCpu = currentEntry.stats.precpu_stats || previousEntry?.stats?.cpu_stats;

    if (!prevCpu?.cpu_usage?.total_usage || !prevCpu?.system_cpu_usage) {
      return 0;
    }

    // Calculate deltas
    const cpuDelta = currentCpu.cpu_usage.total_usage - prevCpu.cpu_usage.total_usage;
    const systemDelta = currentCpu.system_cpu_usage - prevCpu.system_cpu_usage;
    const numberOfCpus = currentCpu.online_cpus || currentCpu.cpu_usage?.percpu_usage?.length || 1;

    // Calculate percentage if we have valid deltas
    if (systemDelta > 0) {
      return Math.max(0, (cpuDelta / systemDelta) * numberOfCpus * 100.0);
    }

    return 0;
  }

  /**
   * Get memory limit from Docker stats
   * Docker stats can have limit in different places depending on Docker version
   */
  getMemoryLimit(memoryStats?: {
    usage?: number;
    max_usage?: number;
    limit?: number;
    stats?: Record<string, unknown>;
  }): number {
    if (!memoryStats) return 0;

    // Try limit directly (some Docker versions)
    if (memoryStats.limit && memoryStats.limit > 0) {
      return memoryStats.limit;
    }

    // Try limit from stats object (common in Docker stats)
    if (memoryStats.stats) {
      const limit = memoryStats.stats['limit'];

      if (typeof limit === 'number' && limit > 0) {
        return limit;
      }
    }

    // Fallback to max_usage if limit is not available (not ideal but better than nothing)
    if (memoryStats.max_usage && memoryStats.max_usage > 0) {
      return memoryStats.max_usage;
    }

    return 0;
  }

  /**
   * Calculate memory usage percentage
   */
  getMemoryUsagePercentage(stats: { memory_usage: number; memory_limit: number }): number {
    if (!stats || stats.memory_limit === 0) return 0;

    return (stats.memory_usage / stats.memory_limit) * 100;
  }
}
