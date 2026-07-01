import type { ProjectTicketStatus } from '@forepath/decabill/frontend/data-access-billing-console';

export function projectTicketLaneStatusLabel(status: string): string {
  switch (status as ProjectTicketStatus) {
    case 'draft':
      return $localize`:@@featureProjectBoard-laneDraft:Draft`;
    case 'todo':
      return $localize`:@@featureProjectBoard-laneTodo:To do`;
    case 'in_progress':
      return $localize`:@@featureProjectBoard-laneInProgress:In progress`;
    case 'prototype':
      return $localize`:@@featureProjectBoard-lanePrototype:Prototype`;
    case 'done':
      return $localize`:@@featureProjectBoard-laneDone:Done`;
    case 'closed':
      return $localize`:@@featureProjectBoard-laneClosed:Closed`;
    default:
      return status;
  }
}
