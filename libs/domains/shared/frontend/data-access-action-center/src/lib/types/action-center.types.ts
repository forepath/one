/**
 * Action center payloads (REST `GET <basePath>` and the `actionCenterSnapshot` socket event). Mirrors the backend
 * contract in `@forepath/shared/backend/feature-action-center`.
 */

export type ActionCenterSeverity = 'info' | 'warning' | 'danger';
export type ActionCenterKind = 'task' | 'setup';
export type ActionCenterAudience = 'administrative' | 'admin';
export type ActionCenterViewerRole = 'admin' | 'manager';
export type ActionCenterParamValue = string | number | boolean | null;
export type ActionCenterParams = Readonly<Record<string, ActionCenterParamValue>>;
export type ActionCenterSilenceAudience = 'self' | 'everyone';

export interface ActionCenterItem {
  id: string;
  params: ActionCenterParams;
  occurredAt: string | null;
  /** Silence hiding this item for the viewer, if any. */
  silencedBy: string | null;
}

export interface ActionCenterGroup {
  type: string;
  category: string;
  severity: ActionCenterSeverity;
  kind: ActionCenterKind;
  audience: ActionCenterAudience;
  /** All matching records (may exceed `items.length`). */
  total: number;
  /** Records the viewer still has to handle (not silenced). */
  openCount: number;
  params: ActionCenterParams;
  items: ActionCenterItem[];
  /** Silence hiding the whole group for the viewer, if any. */
  silencedBy: string | null;
}

export interface ActionCenterSilence {
  id: string;
  itemType: string;
  itemId: string | null;
  audience: ActionCenterSilenceAudience;
  until: string | null;
  createdAt: string;
  createdByUserId: string | null;
  removable: boolean;
}

export interface ActionCenterCounts {
  open: number;
  setup: number;
  silenced: number;
}

export interface ActionCenterView {
  generatedAt: string;
  role: ActionCenterViewerRole;
  canSilenceForEveryone: boolean;
  counts: ActionCenterCounts;
  groups: ActionCenterGroup[];
  silences: ActionCenterSilence[];
}

export interface CreateActionCenterSilence {
  itemType: string;
  /** Omitted / null silences the whole type. */
  itemId?: string | null;
  audience: ActionCenterSilenceAudience;
  /** ISO 8601 end; omitted / null = until removed. */
  until?: string | null;
}

/** Live connection state of the action center socket. */
export type ActionCenterConnectionState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'offline';
