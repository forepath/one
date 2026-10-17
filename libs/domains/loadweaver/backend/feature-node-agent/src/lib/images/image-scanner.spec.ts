import { blockedBy, summarizeTrivy } from './image-scanner';

describe('image scans', () => {
  it('summarizes Trivy reports: counts per severity, fixable ones, most severe first, duplicates once', () => {
    const v = (id: string, severity: string, fixed?: string) => ({
      VulnerabilityID: id,
      PkgName: 'openssl',
      InstalledVersion: '3.0.1',
      Severity: severity,
      ...(fixed ? { FixedVersion: fixed } : {}),
    });
    const summary = summarizeTrivy({
      Results: [
        { Vulnerabilities: [v('CVE-2', 'HIGH'), v('CVE-1', 'CRITICAL', '3.0.2'), v('CVE-1', 'CRITICAL', '3.0.2')] },
        { Vulnerabilities: [v('CVE-3', 'WEIRD')] },
        {},
      ],
    });

    expect(summary.counts.CRITICAL).toEqual({ total: 1, fixable: 1 });
    expect(summary.counts.HIGH).toEqual({ total: 1, fixable: 0 });
    expect(summary.counts.UNKNOWN).toEqual({ total: 1, fixable: 0 });
    expect(summary.findings.map((f) => f.id)).toEqual(['CVE-1', 'CVE-2', 'CVE-3']);
    expect(blockedBy(summary, { mode: 'enforce', block: ['CRITICAL', 'HIGH'], ignoreUnfixed: true })).toBe(1);
    expect(blockedBy(summary, { mode: 'enforce', block: ['CRITICAL', 'HIGH'], ignoreUnfixed: false })).toBe(2);
  });
});
