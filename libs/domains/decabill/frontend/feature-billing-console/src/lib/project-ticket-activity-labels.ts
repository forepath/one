import type { FpcBadgeTone } from '@forepath/shared/frontend/ui-components';
export function projectTicketActivityActionLabel(actionType: string): string {
  switch (actionType) {
    case 'CREATED':
      return $localize`:@@featureProjectBoard-activityActionCreated:Created`;
    case 'DELETED':
      return $localize`:@@featureProjectBoard-activityActionDeleted:Deleted`;
    case 'COMMENT_ADDED':
      return $localize`:@@featureProjectBoard-activityActionCommentAdded:Comment added`;
    case 'STATUS_CHANGED':
      return $localize`:@@featureProjectBoard-activityActionStatusChanged:Status changed`;
    case 'PRIORITY_CHANGED':
      return $localize`:@@featureProjectBoard-activityActionPriorityChanged:Priority changed`;
    case 'PARENT_CHANGED':
      return $localize`:@@featureProjectBoard-activityActionParentChanged:Parent changed`;
    case 'MILESTONE_CHANGED':
      return $localize`:@@featureProjectBoard-activityActionMilestoneChanged:Milestone changed`;
    case 'LOCKED':
      return $localize`:@@featureProjectBoard-activityActionLocked:Locked`;
    case 'FIELD_UPDATED':
      return $localize`:@@featureProjectBoard-activityActionFieldUpdated:Details updated`;
    default:
      return $localize`:@@featureProjectBoard-activityActionUnknown:Unknown activity`;
  }
}

export function projectTicketActivityActionBadgeTone(actionType: string): FpcBadgeTone {
  switch (actionType) {
    case 'CREATED':
      return 'success';
    case 'DELETED':
      return 'danger';
    case 'COMMENT_ADDED':
      return 'info';
    case 'STATUS_CHANGED':
      return 'primary';
    case 'PRIORITY_CHANGED':
      return 'warning';
    case 'LOCKED':
      return 'neutral';
    case 'PARENT_CHANGED':
    case 'MILESTONE_CHANGED':
    case 'FIELD_UPDATED':
      return 'neutral';
    default:
      return 'neutral';
  }
}
