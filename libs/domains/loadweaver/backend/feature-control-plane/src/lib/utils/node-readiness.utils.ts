/**
 * Whether a node is ready for new volume copies (M6 gate). A node that joined recently and hasn't applied its current
 * desired state yet is still initialising — a new control-plane member pulls and starts etcd / Postgres / the API
 * before its agent gets to the volumes layer, so a DRBD copy planned there waits for minutes and the plan's apply
 * times out and rolls back. Such nodes keep the copies they hold but get no new ones (the plan says so); planning
 * again once they are ready adds the copies.
 */

/** After this long a node counts as joined, whatever it reports (no permanent hold on a stuck node). */
export const JOINING_WINDOW_MS = 30 * 60 * 1000;

export interface ReadinessFacts {
  joinedAt: Date | null;
  connected: boolean;
  /** Last revision the agent applied successfully (hello, heartbeats, apply reports). */
  appliedRevision: number;
  lastReportSteps: { layer: string; status: string }[] | null;
  controlPlane: boolean;
}

/**
 * Why the node isn't ready (null: ready). `desiredRevision` is the revision of its stored desired state (undefined:
 * none compiled yet).
 */
export function nodeNotReady(node: ReadinessFacts, desiredRevision: number | undefined, now: number): string | null {
  if (!node.joinedAt || now - node.joinedAt.getTime() > JOINING_WINDOW_MS) return null;

  if (!node.connected) return 'joining: agent not connected yet';

  if (desiredRevision === undefined) return 'joining: no desired state compiled yet';

  const applied = node.appliedRevision;

  if (applied < desiredRevision)
    return node.controlPlane
      ? `joining: control-plane member still initialising (applied revision ${applied} of ${desiredRevision})`
      : `joining: still applying its desired state (applied revision ${applied} of ${desiredRevision})`;

  if (node.controlPlane && node.lastReportSteps?.some((s) => s.layer === 'control-plane' && s.status === 'failed'))
    return 'joining: control-plane role failed to apply';

  return null;
}
