import type { Draft, DraftStatus } from '@forepath/loadweaver/frontend/data-access-console';

import { filterBySearch } from '../list-search';
import { dlUserLabel } from '../section/data-list';

/** The title new drafts get (the tray / list "New draft"). */
export const DRAFT_UNTITLED = $localize`:@@lwConsoleDraft-untitled:Untitled draft`;

/** The owner as people read it (D11): the email, else "API key" / "System" / "Deleted user", never a raw id. */
export function draftOwnerLabel(draft: Pick<Draft, 'owner' | 'ownerEmail'>): string {
  return dlUserLabel(draft.owner, draft.ownerEmail);
}

/**
 * The title as shown: untitled drafts get their creation time, so several of them stay distinguishable (LW-14).
 * `when` formats the creation time (the page's date pipe).
 */
export function draftTitle(draft: Pick<Draft, 'title' | 'createdAt'>, when: (iso: string) => string): string {
  const title = draft.title.trim();

  if (title && title !== DRAFT_UNTITLED) return title;

  const at = when(draft.createdAt);

  return $localize`:@@lwConsoleDraft-untitledAt:Untitled draft from ${at}:at:`;
}

/** The statuses Activity › Drafts can list (`GET /drafts?status=`). */
export const DRAFT_STATUSES: readonly DraftStatus[] = ['open', 'submitted', 'discarded'];

/** Draft state as an `fpc-badge` tone (3.38 R10). */
export const DRAFT_STATUS_TONE: Record<DraftStatus, 'info' | 'success' | 'neutral'> = {
  open: 'info',
  submitted: 'success',
  discarded: 'neutral',
};

export function draftStatusLabel(status: DraftStatus): string {
  switch (status) {
    case 'open':
      return $localize`:@@lwConsoleDrafts-statusOpen:Open`;
    case 'submitted':
      return $localize`:@@lwConsoleDrafts-statusSubmitted:Submitted`;
    case 'discarded':
      return $localize`:@@lwConsoleDrafts-statusDiscarded:Discarded`;
  }
}

/** The projects a draft touches: its `projects`, plus the projects of its ops (cluster-level ops add none). */
export function draftProjects(draft: Pick<Draft, 'projects' | 'ops'>): string[] {
  return [...new Set([...draft.projects, ...draft.ops.flatMap((op) => (op.project ? [op.project] : []))])].sort();
}

/** Newest change first. */
export function sortDrafts(drafts: readonly Draft[]): Draft[] {
  return [...drafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Free-text filter over title, owner, status, projects and the ops' kinds / names. */
export function filterDrafts(drafts: readonly Draft[], query: string): readonly Draft[] {
  return filterBySearch(drafts, query, (draft) => [
    draft.title,
    draft.owner,
    draft.ownerEmail ?? '',
    draft.status,
    draft.id,
    draftProjects(draft),
    draft.ops.map((op) => `${op.kind} ${op.name}`),
  ]);
}
