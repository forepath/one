import {
  formatProjectTimeReportDuration,
  formatProjectTimeReportPeriod,
  formatProjectTimeReportRange,
} from './project-time-report-format.util';

describe('project-time-report-format.util', () => {
  it('formats duration with hours', () => {
    expect(formatProjectTimeReportDuration(90)).toBe('1h 30m');
  });

  it('formats duration minutes only', () => {
    expect(formatProjectTimeReportDuration(45)).toBe('45m');
  });

  it('formats same-day period', () => {
    const period = formatProjectTimeReportPeriod(
      new Date('2026-06-01T08:00:00.000Z'),
      new Date('2026-06-01T10:30:00.000Z'),
    );

    expect(period).toContain('–');
  });

  it('formats report range', () => {
    const range = formatProjectTimeReportRange(
      new Date('2026-06-01T08:00:00.000Z'),
      new Date('2026-06-15T18:00:00.000Z'),
    );

    expect(range).toContain('–');
  });
});
