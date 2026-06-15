import { BadRequestException } from '@nestjs/common';

import type { RegexFilterRuleEntity, RegexFilterRuleType } from '../entities/regex-filter-rule.entity';

const ALLOWED_FLAG_CHARS = new Set(['g', 'i', 'm', 's', 'u', 'y', 'd']);

/**
 * Normalize and validate RegExp flags string (subset allowed by JS).
 */
export function normalizeRegexFlags(flags: string | undefined | null): string {
  const raw = (flags ?? 'g').trim();

  if (raw.length > 16) {
    throw new BadRequestException('regexFlags is too long');
  }

  const seen = new Set<string>();
  let out = '';

  for (const c of raw) {
    if (!ALLOWED_FLAG_CHARS.has(c)) {
      throw new BadRequestException(`Invalid regex flag character: ${c}`);
    }

    if (!seen.has(c)) {
      seen.add(c);
      out += c;
    }
  }

  return out;
}

/**
 * Try to compile pattern + flags; throws BadRequestException on invalid regex.
 */
export function compileRegexOrThrow(pattern: string, flags: string): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch {
    throw new BadRequestException('Invalid regular expression');
  }
}

/**
 * Whether message matches the rule pattern (uses search to avoid lastIndex issues).
 */
export function ruleMatchesMessage(rule: RegexFilterRuleEntity, message: string): boolean {
  const flags = normalizeRegexFlags(rule.regexFlags);
  const re = compileRegexOrThrow(rule.pattern, flags);

  return re.test(message);
}

/**
 * Apply replace for filter type; uses same RegExp as match check.
 */
export function applyReplace(rule: RegexFilterRuleEntity, message: string): string {
  const flags = normalizeRegexFlags(rule.regexFlags);
  const re = compileRegexOrThrow(rule.pattern, flags);
  const replacement = rule.replaceContent ?? '';

  return message.replace(re, replacement);
}

export function assertReplaceContentForFilterType(
  filterType: RegexFilterRuleType,
  replaceContent: string | null | undefined,
): void {
  if (filterType === 'filter' && (replaceContent === undefined || replaceContent === null)) {
    throw new BadRequestException('replaceContent is required when filterType is filter');
  }
}
