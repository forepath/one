import { computeMilestoneProgressPercent, isMilestoneComplete } from './project-milestone-progress.utils';

describe('project-milestone-progress.utils', () => {
  describe('computeMilestoneProgressPercent', () => {
    it('returns 100 when milestone has no tickets', () => {
      expect(computeMilestoneProgressPercent(0, 0)).toBe(100);
    });

    it('returns rounded done percentage', () => {
      expect(computeMilestoneProgressPercent(1, 2)).toBe(67);
    });
  });

  describe('isMilestoneComplete', () => {
    it('treats 100 percent as complete', () => {
      expect(isMilestoneComplete(100)).toBe(true);
    });

    it('treats less than 100 percent as open', () => {
      expect(isMilestoneComplete(99)).toBe(false);
    });
  });
});
