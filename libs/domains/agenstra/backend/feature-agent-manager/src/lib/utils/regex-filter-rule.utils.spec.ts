import { BadRequestException } from '@nestjs/common';

import type { RegexFilterRuleEntity } from '../entities/regex-filter-rule.entity';

import {
  applyReplace,
  assertReplaceContentForFilterType,
  compileRegexOrThrow,
  normalizeRegexFlags,
  ruleMatchesMessage,
} from './regex-filter-rule.utils';

describe('regex-filter-rule.utils', () => {
  it('normalizeRegexFlags dedupes and orders conservatively', () => {
    expect(normalizeRegexFlags('ggi')).toBe('gi');
  });

  it('normalizeRegexFlags rejects invalid chars', () => {
    expect(() => normalizeRegexFlags('x')).toThrow(BadRequestException);
  });

  it('compileRegexOrThrow throws on invalid pattern', () => {
    expect(() => compileRegexOrThrow('(', 'g')).toThrow(BadRequestException);
  });

  it('assertReplaceContentForFilterType requires replace for filter', () => {
    expect(() => assertReplaceContentForFilterType('filter', null)).toThrow(BadRequestException);
  });

  it('ruleMatchesMessage and applyReplace', () => {
    const rule = {
      pattern: 'foo',
      regexFlags: 'g',
      direction: 'incoming',
      filterType: 'filter',
      replaceContent: 'bar',
      priority: 0,
    } as RegexFilterRuleEntity;

    expect(ruleMatchesMessage(rule, 'hello foo')).toBe(true);
    expect(applyReplace(rule, 'hello foo')).toBe('hello bar');
  });
});
