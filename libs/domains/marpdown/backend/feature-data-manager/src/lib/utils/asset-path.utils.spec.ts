import { BadRequestException } from '@nestjs/common';

import { getBaseName, getParentPath, isDirectChild, normalizeAssetPath } from './asset-path.utils';

describe('asset-path.utils', () => {
  it('normalizes nested paths', () => {
    expect(normalizeAssetPath('assets/logo.png')).toBe('assets/logo.png');
    expect(normalizeAssetPath('./assets/logo.png')).toBe('assets/logo.png');
  });

  it('rejects presentation markdown path', () => {
    expect(() => normalizeAssetPath('presentation.md')).toThrow(BadRequestException);
  });

  it('detects direct children', () => {
    expect(isDirectChild(null, 'assets')).toBe(true);
    expect(isDirectChild(null, 'assets/logo.png')).toBe(false);
    expect(isDirectChild('assets', 'assets/logo.png')).toBe(true);
  });

  it('extracts parent and basename', () => {
    expect(getParentPath('assets/logo.png')).toBe('assets');
    expect(getBaseName('assets/logo.png')).toBe('logo.png');
  });
});
