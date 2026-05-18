export type AttentionBadgeKind = 'git' | 'unread' | 'both';

export function resolveAttentionBadgeKind(gitDirty: boolean, hasUnread: boolean): AttentionBadgeKind | null {
  if (gitDirty && hasUnread) {
    return 'both';
  }

  if (gitDirty) {
    return 'git';
  }

  if (hasUnread) {
    return 'unread';
  }

  return null;
}

export function resolveSpacesAttentionBadgeKind(
  clients: ReadonlyArray<{ gitDirty: boolean; hasUnreadMessages: boolean }>,
): AttentionBadgeKind | null {
  const anyGitDirty = clients.some((client) => client.gitDirty);
  const anyUnread = clients.some((client) => client.hasUnreadMessages);

  return resolveAttentionBadgeKind(anyGitDirty, anyUnread);
}
