import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { tarArchive } from '../test-fixtures';
import { blockedBy, extractNestedRootfs, nestedRootfs, summarizeTrivy } from './image-scanner';

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

  it('follows io.forepath.scan.nested-rootfs only for plain absolute paths (3.35)', () => {
    expect(nestedRootfs({ 'io.forepath.scan.nested-rootfs': '/guest' })).toBe('/guest');
    expect(nestedRootfs({ 'io.forepath.scan.nested-rootfs': '/guest/./' })).toBe('/guest');
    expect(nestedRootfs({ 'io.forepath.scan.nested-rootfs': '/guest/../etc' })).toBeNull();
    expect(nestedRootfs({ 'io.forepath.scan.nested-rootfs': 'guest' })).toBeNull();
    expect(nestedRootfs({ 'io.forepath.scan.nested-rootfs': '/' })).toBeNull();
    expect(nestedRootfs({})).toBeNull();
    expect(nestedRootfs(undefined)).toBeNull();
  });

  it('extracts only the nested root of an exported file system, with the unpack path rules', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lw-nested-'));
    const uid = process.getuid?.() ?? 0;
    const gid = process.getgid?.() ?? 0;

    try {
      const exported = tarArchive(
        [
          { name: 'usr/bin/qemu', data: 'launcher' },
          { name: 'guest/', type: '5', mode: 0o755 },
          { name: 'guest/etc/os-release', data: 'ID=debian\n' },
          { name: 'guest/usr/lib/libssl.so', data: 'lib' },
          { name: 'guest/lib/libssl.so', type: '1', linkname: 'guest/usr/lib/libssl.so' },
          { name: 'guest/lib/outside', type: '1', linkname: 'usr/bin/qemu' },
          { name: 'guest/dev/null', type: '3' },
        ].map((e) => ({ uid, gid, ...e })),
      );
      const count = await extractNestedRootfs(Readable.from([exported]), '/guest', dir);

      expect(count).toBe(4);
      expect(await readFile(join(dir, 'etc/os-release'), 'utf8')).toBe('ID=debian\n');
      expect((await lstat(join(dir, 'lib/libssl.so'))).nlink).toBe(2);
      await expect(lstat(join(dir, 'usr/bin/qemu'))).rejects.toThrow();
      await expect(lstat(join(dir, 'lib/outside'))).rejects.toThrow();
      await expect(lstat(join(dir, 'dev/null'))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
