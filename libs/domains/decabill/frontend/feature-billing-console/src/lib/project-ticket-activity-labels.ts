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

export function projectTicketActivityActionBadgeClass(actionType: string): string {
  switch (actionType) {
    case 'CREATED':
      return 'project-board__chip--activity-created';
    case 'DELETED':
      return 'project-board__chip--activity-deleted';
    case 'COMMENT_ADDED':
      return 'project-board__chip--activity-comment';
    case 'STATUS_CHANGED':
      return 'project-board__chip--activity-status';
    case 'PRIORITY_CHANGED':
      return 'project-board__chip--activity-priority';
    case 'LOCKED':
      return 'project-board__chip--activity-muted';
    case 'PARENT_CHANGED':
    case 'MILESTONE_CHANGED':
    case 'FIELD_UPDATED':
      return 'project-board__chip--activity-muted';
    default:
      return 'project-board__chip--neutral';
  }
}
