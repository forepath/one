/**
 * Two-phase removal of replicas (M6 gate; plan-removed replicas and autoscaler scale-down): first the replica leaves
 * routing — service IPs, mesh upstreams, ingress upstreams, health-gated announcements — while it keeps running its
 * last released spec, then, after the service's `stop_grace_period` (capped), the placement is deleted and the agent
 * stops the container. The deadline is stored on the placement (`drain_until`), so a drain survives restarts.
 */

/** Compose's default `stop_grace_period`. */
export const DEFAULT_DRAIN_MS = 10_000;
/** Long grace periods don't hold a removed replica for longer than this. */
export const MAX_DRAIN_MS = 120_000;
/** At least one desired-state push without the replica in routing goes out before it stops. */
export const MIN_DRAIN_MS = 2_000;

/** How long a removed replica drains: its service's stop grace period, within [MIN_DRAIN_MS, MAX_DRAIN_MS]. */
export function drainDelayMs(stopGracePeriodMs: number | null | undefined): number {
  const grace =
    typeof stopGracePeriodMs === 'number' && Number.isFinite(stopGracePeriodMs) ? stopGracePeriodMs : DEFAULT_DRAIN_MS;

  return Math.min(MAX_DRAIN_MS, Math.max(MIN_DRAIN_MS, grace));
}

/** Whether a placement is draining (removed, out of routing, still running until its deadline). */
export function isDraining(placement: { drainUntil?: Date | string | null }): boolean {
  return placement.drainUntil !== null && placement.drainUntil !== undefined;
}

/** A draining placement whose deadline passed: delete it (the agent stops the container). */
export function drainFinished(placement: { drainUntil?: Date | string | null }, now: Date): boolean {
  return isDraining(placement) && new Date(placement.drainUntil as Date | string).getTime() <= now.getTime();
}

/**
 * The deadline for a placement that is being removed: an existing drain keeps its (earlier) deadline, so planning
 * again never prolongs it.
 */
export function drainDeadline(
  placement: { drainUntil?: Date | string | null },
  stopGracePeriodMs: number | null | undefined,
  now: Date,
): Date {
  const next = new Date(now.getTime() + drainDelayMs(stopGracePeriodMs));

  if (!isDraining(placement)) return next;

  const current = new Date(placement.drainUntil as Date | string);

  return current.getTime() <= next.getTime() ? current : next;
}

/**
 * What happens to a removed placement: `drain` (stays, out of routing, until the deadline) unless it can't drain —
 * its node is gone (failover) or nothing of it runs right now (a short-stop migration already stopped it) — then
 * `delete` at once.
 */
export function removalAction(
  placement: { node: string; migration?: { method: string; phase: string } | null },
  liveNodes: ReadonlySet<string>,
): 'drain' | 'delete' {
  if (!liveNodes.has(placement.node)) return 'delete';

  if (placement.migration?.method === 'short-stop' && placement.migration.phase === 'stopping') return 'delete';

  return 'drain';
}
