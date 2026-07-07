import {
  computeProjectCompletionProgress,
  computeProjectMilestonesCompleteProgress,
  computeProjectOpenDoneProgress,
  computeProjectTargetHoursProgress,
  computeProjectTicketsDoneProgress,
  formatProjectTargetHoursDuration,
  formatProjectTargetHoursLabel,
  hasProjectTargetHours,
} from './project-summary-progress.utils';

describe('project-summary-progress.utils', () => {
  describe('hasProjectTargetHours', () => {
    it('returns true for positive finite hours', () => {
      expect(hasProjectTargetHours(10)).toBe(true);
    });

    it('returns false for null, undefined, zero, and invalid values', () => {
      expect(hasProjectTargetHours(null)).toBe(false);
      expect(hasProjectTargetHours(undefined)).toBe(false);
      expect(hasProjectTargetHours(0)).toBe(false);
    });
  });

  describe('computeProjectCompletionProgress', () => {
    it('returns 100 percent when total is zero', () => {
      expect(computeProjectCompletionProgress(0, 0)).toEqual({
        primaryPct: 100,
        dangerPct: 0,
        isOver: false,
      });
    });

    it('returns completion percentage', () => {
      expect(computeProjectCompletionProgress(2, 5)).toEqual({
        primaryPct: 40,
        dangerPct: 0,
        isOver: false,
      });
    });
  });

  describe('computeProjectOpenDoneProgress', () => {
    it('returns 100 percent done when there are no items', () => {
      expect(computeProjectOpenDoneProgress(0, 0)).toEqual({
        primaryPct: 100,
        dangerPct: 0,
        isOver: false,
      });
    });

    it('places open before done percentages', () => {
      expect(computeProjectOpenDoneProgress(1, 3)).toEqual({
        openPct: 25,
        primaryPct: 75,
        dangerPct: 0,
        isOver: false,
      });
    });
  });

  describe('computeProjectTicketsDoneProgress', () => {
    it('returns 100 percent when there are no tickets', () => {
      expect(computeProjectTicketsDoneProgress(0, 0)).toEqual({
        primaryPct: 100,
        dangerPct: 0,
        isOver: false,
      });
    });

    it('returns done ticket percentage', () => {
      expect(computeProjectTicketsDoneProgress(1, 3)).toEqual({
        primaryPct: 75,
        dangerPct: 0,
        isOver: false,
      });
    });
  });

  describe('computeProjectMilestonesCompleteProgress', () => {
    it('returns 100 percent when there are no milestones', () => {
      expect(computeProjectMilestonesCompleteProgress(0, 0)).toEqual({
        primaryPct: 100,
        dangerPct: 0,
        isOver: false,
      });
    });

    it('returns completed milestone percentage', () => {
      expect(computeProjectMilestonesCompleteProgress(1, 4)).toEqual({
        primaryPct: 75,
        dangerPct: 0,
        isOver: false,
      });
    });
  });

  describe('computeProjectTargetHoursProgress', () => {
    it('returns full primary bar when no target is set', () => {
      expect(computeProjectTargetHoursProgress(120, null)).toEqual({
        primaryPct: 100,
        dangerPct: 0,
        isOver: false,
      });
    });

    it('returns partial primary fill when under target', () => {
      expect(computeProjectTargetHoursProgress(300, 10)).toEqual({
        primaryPct: 50,
        dangerPct: 0,
        isOver: false,
      });
    });

    it('splits primary and danger when over target', () => {
      expect(computeProjectTargetHoursProgress(720, 10)).toEqual({
        primaryPct: (600 / 720) * 100,
        dangerPct: (120 / 720) * 100,
        isOver: true,
      });
    });
  });

  describe('formatProjectTargetHoursDuration', () => {
    it('formats target hours as duration', () => {
      expect(formatProjectTargetHoursDuration(10)).toBe('10h 0m');
    });
  });

  describe('formatProjectTargetHoursLabel', () => {
    it('includes formatted duration with target prefix', () => {
      expect(formatProjectTargetHoursLabel(10)).toContain('10h 0m');
    });
  });
});
