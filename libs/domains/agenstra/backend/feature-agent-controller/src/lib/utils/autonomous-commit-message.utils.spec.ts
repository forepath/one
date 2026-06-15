import {
  buildAutonomousCommitMessagePrompt,
  buildFallbackAutonomousCommitMessage,
  isPlausibleConventionalSubject,
  sanitizeConventionalCommitSubject,
} from './autonomous-commit-message.utils';

describe('autonomous-commit-message.utils', () => {
  describe('buildAutonomousCommitMessagePrompt', () => {
    it('includes ticket id, title, and branch', () => {
      const p = buildAutonomousCommitMessagePrompt(
        { id: '00000000-0000-4000-8000-000000000001', title: 'Add login' },
        'automation/abcd1234',
      );

      expect(p).toContain('00000000-0000-4000-8000-000000000001');
      expect(p).toContain('Add login');
      expect(p).toContain('automation/abcd1234');
      expect(p).toContain('Conventional Commits');
    });
  });

  describe('sanitizeConventionalCommitSubject', () => {
    it('accepts a valid conventional subject', () => {
      expect(sanitizeConventionalCommitSubject('feat(automation): add user prefs')).toBe(
        'feat(automation): add user prefs',
      );
    });

    it('takes the first line only', () => {
      expect(sanitizeConventionalCommitSubject('feat: foo\nextra')).toBe('feat: foo');
    });

    it('rejects empty or non-conventional text', () => {
      expect(sanitizeConventionalCommitSubject('')).toBeNull();
      expect(sanitizeConventionalCommitSubject('just some text')).toBeNull();
      expect(sanitizeConventionalCommitSubject('```\nfeat: x')).toBeNull();
    });

    it('strips simple surrounding quotes', () => {
      expect(sanitizeConventionalCommitSubject('"fix: handle edge case"')).toBe('fix: handle edge case');
    });
  });

  describe('isPlausibleConventionalSubject', () => {
    it('matches common types', () => {
      expect(isPlausibleConventionalSubject('feat(scope): thing')).toBe(true);
      expect(isPlausibleConventionalSubject('fix: thing')).toBe(true);
      expect(isPlausibleConventionalSubject('chore: bump')).toBe(true);
    });
  });

  describe('buildFallbackAutonomousCommitMessage', () => {
    it('prefixes feat(automation) with truncated title', () => {
      expect(buildFallbackAutonomousCommitMessage({ title: 'Hello' })).toBe('feat(automation): Hello');
    });

    it('handles empty title', () => {
      expect(buildFallbackAutonomousCommitMessage({ title: '' })).toBe('feat(automation): prototype run');
    });
  });
});
