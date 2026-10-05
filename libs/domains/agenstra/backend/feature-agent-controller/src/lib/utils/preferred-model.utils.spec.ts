import { BadRequestException } from '@nestjs/common';

import { assertValidPreferredModel, normalizePreferredModel } from './preferred-model.utils';

describe('preferred-model.utils', () => {
  it('normalizePreferredModel trims and maps empty to null', () => {
    expect(normalizePreferredModel(null)).toBeNull();
    expect(normalizePreferredModel(undefined)).toBeNull();
    expect(normalizePreferredModel('')).toBeNull();
    expect(normalizePreferredModel('  ')).toBeNull();
    expect(normalizePreferredModel('  opencode/gpt-5  ')).toBe('opencode/gpt-5');
  });

  it('assertValidPreferredModel accepts provider/model ids', () => {
    expect(assertValidPreferredModel('anthropic/claude-sonnet-4')).toBe('anthropic/claude-sonnet-4');
    expect(assertValidPreferredModel('opencode/gpt-5.2')).toBe('opencode/gpt-5.2');
  });

  it('assertValidPreferredModel rejects invalid shapes', () => {
    expect(() => assertValidPreferredModel('noshslash')).toThrow(BadRequestException);
    expect(() => assertValidPreferredModel('/only-model')).toThrow(BadRequestException);
    expect(() => assertValidPreferredModel('provider/')).toThrow(BadRequestException);
  });
});
