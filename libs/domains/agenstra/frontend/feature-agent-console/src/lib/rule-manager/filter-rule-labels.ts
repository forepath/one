/**
 * Human-readable labels for filter rule API values (direction, filter type).
 * Unknown values pass through for forward compatibility.
 */

export function filterRuleDirectionLabel(direction: string): string {
  switch (direction) {
    case 'incoming':
      return $localize`:@@featureRuleManager-directionIncoming:Incoming`;
    case 'outgoing':
      return $localize`:@@featureRuleManager-directionOutgoing:Outgoing`;
    case 'bidirectional':
      return $localize`:@@featureRuleManager-directionBidirectional:Bidirectional`;
    default:
      return direction;
  }
}

export function filterRuleTypeLabel(filterType: string): string {
  switch (filterType) {
    case 'none':
      return $localize`:@@featureRuleManager-filterTypeNone:No content change`;
    case 'filter':
      return $localize`:@@featureRuleManager-filterTypeReplace:Replace content`;
    case 'drop':
      return $localize`:@@featureRuleManager-filterTypeDrop:Drop message`;
    default:
      return filterType;
  }
}

export function filterRuleTesterNoMatch(): string {
  return $localize`:@@featureRuleManager-testerNoMatch:No match.`;
}

export function filterRuleTesterWouldDrop(): string {
  return $localize`:@@featureRuleManager-testerWouldDrop:Match: the message would be dropped.`;
}

export function filterRuleTesterNoContentChange(): string {
  return $localize`:@@featureRuleManager-testerNoContentChange:Match: no content change.`;
}

export function filterRuleTesterReplacedMessage(replaced: string): string {
  const head = $localize`:@@featureRuleManager-testerReplacedHead:Match: replaced result:`;

  return `${head}\n${replaced}`;
}

/** Tooltip for workspace sync icon (shows lastError when sync failed). */
export function filterRuleWorkspaceSyncTitle(
  row: { syncStatus: string; lastError?: string | null } | undefined,
): string {
  const status = row?.syncStatus ?? 'pending';

  if (status === 'failed' && row?.lastError) {
    return row.lastError;
  }

  if (status === 'failed') {
    return $localize`:@@featureRuleManager-syncWsTitleFailed:Sync to agent-manager failed`;
  }

  if (status === 'synced') {
    return $localize`:@@featureRuleManager-syncWsTitleSynced:Synced to agent-manager`;
  }

  return $localize`:@@featureRuleManager-syncWsTitlePending:Waiting to sync to agent-manager`;
}
