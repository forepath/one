import { resolveAttentionBadgeKind, resolveSpacesAttentionBadgeKind } from './notifications-attention.util';

describe('notifications attention util', () => {
  describe('resolveAttentionBadgeKind', () => {
    it('returns both when git is dirty and there are unread messages', () => {
      expect(resolveAttentionBadgeKind(true, true)).toBe('both');
    });

    it('returns git when only git is dirty', () => {
      expect(resolveAttentionBadgeKind(true, false)).toBe('git');
    });

    it('returns unread when only there are unread messages', () => {
      expect(resolveAttentionBadgeKind(false, true)).toBe('unread');
    });

    it('returns null when there is no attention', () => {
      expect(resolveAttentionBadgeKind(false, false)).toBeNull();
    });
  });

  describe('resolveSpacesAttentionBadgeKind', () => {
    it('aggregates git and unread across clients', () => {
      expect(
        resolveSpacesAttentionBadgeKind([
          { gitDirty: true, hasUnreadMessages: false },
          { gitDirty: false, hasUnreadMessages: true },
        ]),
      ).toBe('both');
    });
  });
});
