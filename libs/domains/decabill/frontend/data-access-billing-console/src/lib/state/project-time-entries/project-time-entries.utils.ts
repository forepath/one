import type { ProjectTimeEntryResponse } from '../../types/projects.types';

import type { ProjectTicketTimeEntriesScope } from './project-time-entries.reducer';

export function upsertProjectTimeEntry(
  entries: ProjectTimeEntryResponse[],
  entry: ProjectTimeEntryResponse,
): ProjectTimeEntryResponse[] {
  const idx = entries.findIndex((e) => e.id === entry.id);

  if (idx < 0) {
    return [entry, ...entries];
  }

  return entries.map((e) => (e.id === entry.id ? entry : e));
}

export function removeProjectTimeEntry(entries: ProjectTimeEntryResponse[], id: string): ProjectTimeEntryResponse[] {
  return entries.filter((e) => e.id !== id);
}

export function syncTicketScopeOnUpsert(
  scope: ProjectTicketTimeEntriesScope,
  entry: ProjectTimeEntryResponse,
): ProjectTicketTimeEntriesScope {
  if (!scope.ticketId || scope.projectId !== entry.projectId) {
    return scope;
  }

  const hadEntry = scope.entries.some((e) => e.id === entry.id);
  const matches = entry.ticketId === scope.ticketId;

  if (matches) {
    return { ...scope, entries: upsertProjectTimeEntry(scope.entries, entry) };
  }

  if (hadEntry) {
    return { ...scope, entries: removeProjectTimeEntry(scope.entries, entry.id) };
  }

  return scope;
}
