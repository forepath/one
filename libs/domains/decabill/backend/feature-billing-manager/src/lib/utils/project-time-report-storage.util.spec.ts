import { buildProjectTimeReportStorageKey } from './project-time-report-storage.util';

describe('buildProjectTimeReportStorageKey', () => {
  it('uses subscription folder when present', () => {
    expect(
      buildProjectTimeReportStorageKey({
        id: 'inv-1',
        subscriptionId: 'sub-1',
        userId: 'user-1',
      }),
    ).toBe('sub-1/inv-1-time-report.pdf');
  });

  it('uses manual user folder when subscription is missing', () => {
    expect(
      buildProjectTimeReportStorageKey({
        id: 'inv-2',
        subscriptionId: null,
        userId: 'user-2',
      }),
    ).toBe('manual/user-2/inv-2-time-report.pdf');
  });

  it('treats blank subscription id as manual', () => {
    expect(
      buildProjectTimeReportStorageKey({
        id: 'inv-3',
        subscriptionId: '   ',
        userId: 'user-3',
      }),
    ).toBe('manual/user-3/inv-3-time-report.pdf');
  });
});
