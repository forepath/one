import { BadRequestException } from '@nestjs/common';

import {
  ancestorLayerPaths,
  childSegmentUnder,
  inferLayerEntryKind,
  joinLayerChildPath,
  parentLayerPath,
  sanitizeLayerRelativePath,
  sha256Hex,
  toEmittedLayerPath,
} from './opencode-layer-file-path.utils';

describe('opencode-layer-file-path.utils', () => {
  it('sanitizes paths as-is and rejects traversal', () => {
    expect(sanitizeLayerRelativePath('./a/b.md')).toBe('a/b.md');
    expect(sanitizeLayerRelativePath('/tmp/skills/foo')).toBe('/tmp/skills/foo');
    expect(sanitizeLayerRelativePath('skills/foo.md')).toBe('skills/foo.md');
    expect(() => sanitizeLayerRelativePath('../secret')).toThrow(BadRequestException);
    expect(() => sanitizeLayerRelativePath('C:\\windows')).toThrow(BadRequestException);
    expect(() => sanitizeLayerRelativePath('/opt/skills/**')).toThrow(BadRequestException);
    expect(() => sanitizeLayerRelativePath('skills/*')).toThrow(BadRequestException);
  });

  it('emits the sanitized path without managed prefixes', () => {
    expect(toEmittedLayerPath('global', 'skills/foo.md')).toBe('skills/foo.md');
    expect(toEmittedLayerPath('workspace', '/tmp/skills/x.md')).toBe('/tmp/skills/x.md');
    expect(toEmittedLayerPath('global', '.agenstra/layer/global/a.md')).toBe('.agenstra/layer/global/a.md');
  });

  it('computes parents, ancestors, and child segments', () => {
    expect(parentLayerPath('skills/foo/bar.md')).toBe('skills/foo');
    expect(parentLayerPath('/tmp/a')).toBe('/tmp');
    expect(parentLayerPath('foo.md')).toBe(null);
    expect(ancestorLayerPaths('skills/foo/bar.md')).toEqual(['skills', 'skills/foo']);
    expect(ancestorLayerPaths('/tmp/skills/x')).toEqual(['/tmp', '/tmp/skills']);
    expect(inferLayerEntryKind('skills/foo')).toBe('directory');
    expect(inferLayerEntryKind('skills/foo/SKILL.md')).toBe('file');
    expect(childSegmentUnder('skills', 'skills/foo/bar.md')).toBe('foo');
    expect(childSegmentUnder('.', 'skills/foo.md')).toBe('skills');
    expect(childSegmentUnder('.', '/opt/skills/test')).toBe('opt');
    expect(childSegmentUnder('/opt/skills/test', '/opt/skills/test/a.md')).toBe('a.md');
    expect(joinLayerChildPath('/opt/skills', 'abc')).toBe('/opt/skills/abc');
    expect(joinLayerChildPath('/', 'opt')).toBe('/opt');
    expect(joinLayerChildPath('.', 'skills')).toBe('skills');
  });

  it('hashes content', () => {
    expect(sha256Hex('hi')).toHaveLength(64);
  });
});
