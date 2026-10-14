import {
  MESSAGE_FILTERS_CONFIG_ROOT,
  isPlainPolicyObject,
  orderPolicyLayersHighToLow,
  policyValidationError,
  type PlatformPolicyLayer,
  type PlatformPolicyLayerInput,
} from './platform-policy';

/**
 * Chat message filter rules (regex) stored per configuration layer under `message_filters`.
 *
 * Precedence mirrors allow/deny lists: the most restrictive outcome wins.
 * - any matching `drop` rule drops the message (first match by layer precedence is reported)
 * - otherwise every matching `replace` rule rewrites the message in precedence order
 * - otherwise any matching `flag` rule flags the message (content unchanged)
 * Layers are evaluated global → workspace → environment; lower layers may append rules but
 * never remove or edit inherited ones.
 */
export const MESSAGE_FILTER_ACTIONS = ['drop', 'replace', 'flag'] as const;
export type MessageFilterAction = (typeof MESSAGE_FILTER_ACTIONS)[number];

export const MESSAGE_FILTER_DIRECTIONS = ['incoming', 'outgoing', 'bidirectional'] as const;
export type MessageFilterDirection = (typeof MESSAGE_FILTER_DIRECTIONS)[number];

export const MESSAGE_FILTER_MAX_RULES_PER_LAYER = 200;
export const MESSAGE_FILTER_MAX_PATTERN_LENGTH = 2000;
export const MESSAGE_FILTER_MAX_REPLACEMENT_LENGTH = 2000;
export const MESSAGE_FILTER_MAX_NAME_LENGTH = 120;
export const MESSAGE_FILTER_ALLOWED_FLAGS = ['g', 'i', 'm', 's', 'u', 'y', 'd'] as const;

/** Stored (snake_case-free; flat) rule shape inside `message_filters`. */
export interface MessageFilterRuleConfig {
  name: string;
  pattern: string;
  flags?: string;
  direction?: MessageFilterDirection;
  action: MessageFilterAction;
  replacement?: string;
  enabled?: boolean;
}

export interface EffectiveMessageFilterRule {
  name: string;
  pattern: string;
  flags: string;
  direction: MessageFilterDirection;
  action: MessageFilterAction;
  replacement?: string;
  enabled: boolean;
  source: PlatformPolicyLayer;
}

export interface MessageFilterEvaluation {
  status: 'allowed' | 'filtered' | 'dropped';
  /** Rule reported as the cause (drop rule, first replace rule, or first flag rule). */
  matchedRule?: EffectiveMessageFilterRule;
  /** Rewritten content when one or more replace rules matched. */
  modifiedMessage?: string;
  /** All rules that matched, in evaluation order. */
  matchedRules: EffectiveMessageFilterRule[];
}

/**
 * Normalize and validate RegExp flags (subset allowed by JS). Defaults to `g`.
 * @throws OpencodeConfigValidationError
 */
export function normalizeMessageFilterFlags(flags: string | undefined | null): string {
  const raw = (flags ?? 'g').trim();

  if (raw.length > MESSAGE_FILTER_ALLOWED_FLAGS.length) {
    throw policyValidationError('Regex flags are too long');
  }

  const seen = new Set<string>();
  let out = '';

  for (const char of raw) {
    if (!(MESSAGE_FILTER_ALLOWED_FLAGS as readonly string[]).includes(char)) {
      throw policyValidationError(`Invalid regex flag character: ${char}`);
    }

    if (!seen.has(char)) {
      seen.add(char);
      out += char;
    }
  }

  return out;
}

/** Index of the first body character of a group opened at `index` (skips `?:`, `?=`, `?<name>`, …). */
function groupBodyStart(pattern: string, index: number): number {
  if (pattern[index + 1] !== '?') {
    return index + 1;
  }

  const next = pattern[index + 2];

  if (next === ':' || next === '=' || next === '!') {
    return index + 3;
  }

  if (next === '<') {
    const after = pattern[index + 3];

    if (after === '=' || after === '!') {
      return index + 4;
    }

    const close = pattern.indexOf('>', index + 3);

    return close === -1 ? index + 3 : close + 1;
  }

  return index + 2;
}

/**
 * Whether the alternatives of a repeated group can match the same input, e.g. `(a|aa)+` or
 * `(\w|x)*`. Only branches starting with distinct literal characters are considered safe.
 */
function hasAmbiguousAlternation(pattern: string, branchStarts: readonly number[]): boolean {
  if (branchStarts.length < 2) {
    return false;
  }

  const seen = new Set<string>();

  for (const start of branchStarts) {
    const char = pattern[start];

    if (char === undefined || '|)\\[(.^$*+?{'.includes(char)) {
      return true;
    }

    const key = char.toLowerCase();

    if (seen.has(key)) {
      return true;
    }

    seen.add(key);
  }

  return false;
}

/**
 * Heuristic guard against catastrophic backtracking (ReDoS): rejects a quantified group whose
 * body is itself quantified, e.g. `(a+)+`, `(\w*)*`, `(x{1,9})+`, and repeated groups with
 * overlapping alternatives, e.g. `(a|aa)+`. Workspace managers can author rules, and rules run
 * synchronously on every chat message in the agent manager (and on egress evaluation requests).
 */
export function hasNestedQuantifier(pattern: string): boolean {
  const stack: Array<{ quantified: boolean; branchStarts: number[] }> = [];
  let escaped = false;
  let inClass = false;

  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (inClass) {
      if (char === ']') {
        inClass = false;
      }

      continue;
    }

    if (char === '[') {
      inClass = true;
      continue;
    }

    if (char === '(') {
      stack.push({ quantified: false, branchStarts: [groupBodyStart(pattern, index)] });
      continue;
    }

    if (char === '|') {
      stack[stack.length - 1]?.branchStarts.push(index + 1);
      continue;
    }

    const isQuantifier = char === '+' || char === '*' || char === '{' || (char === '?' && pattern[index - 1] !== '(');

    if (char === ')') {
      const group = stack.pop();
      const next = pattern[index + 1];
      const groupQuantified = next === '+' || next === '*' || next === '{' || next === '?';

      if (group?.quantified && groupQuantified && next !== '?') {
        return true;
      }

      if (group && groupQuantified && next !== '?' && hasAmbiguousAlternation(pattern, group.branchStarts)) {
        return true;
      }

      if (group?.quantified && stack.length > 0) {
        stack[stack.length - 1].quantified = true;
      }

      if (groupQuantified && stack.length > 0) {
        stack[stack.length - 1].quantified = true;
      }

      continue;
    }

    if (isQuantifier && stack.length > 0 && char !== '?') {
      stack[stack.length - 1].quantified = true;
    }
  }

  return false;
}

/**
 * Compile a rule pattern, throwing a validation error for invalid / unsafe regexes.
 * @throws OpencodeConfigValidationError
 */
export function compileMessageFilterPattern(pattern: string, flags: string): RegExp {
  if (pattern.length > MESSAGE_FILTER_MAX_PATTERN_LENGTH) {
    throw policyValidationError(`Pattern exceeds ${MESSAGE_FILTER_MAX_PATTERN_LENGTH} characters`);
  }

  if (hasNestedQuantifier(pattern)) {
    throw policyValidationError(
      'Pattern uses nested quantifiers or overlapping repeated alternatives (e.g. "(a+)+", "(a|aa)+"), which risk catastrophic backtracking',
    );
  }

  try {
    return new RegExp(pattern, flags);
  } catch {
    throw policyValidationError('Invalid regular expression');
  }
}

/**
 * Validate a layer's `message_filters` value.
 * @throws OpencodeConfigValidationError
 */
export function assertValidMessageFilters(value: unknown, path = `/${MESSAGE_FILTERS_CONFIG_ROOT}`): void {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    throw policyValidationError(`'${path}' must be an array of rules`);
  }

  if (value.length > MESSAGE_FILTER_MAX_RULES_PER_LAYER) {
    throw policyValidationError(`'${path}' may contain at most ${MESSAGE_FILTER_MAX_RULES_PER_LAYER} rules`);
  }

  const names = new Set<string>();

  for (const [index, rule] of value.entries()) {
    const rulePath = `${path}/${index}`;

    if (!isPlainPolicyObject(rule)) {
      throw policyValidationError(`'${rulePath}' must be an object`);
    }

    const unknown = Object.keys(rule).filter(
      (key) => !['name', 'pattern', 'flags', 'direction', 'action', 'replacement', 'enabled'].includes(key),
    );

    if (unknown.length > 0) {
      throw policyValidationError(`Unknown keys at '${rulePath}': ${unknown.join(', ')}`);
    }

    const name = rule['name'];

    if (typeof name !== 'string' || !name.trim() || name.length > MESSAGE_FILTER_MAX_NAME_LENGTH) {
      throw policyValidationError(
        `'${rulePath}/name' must be a non-empty string of at most ${MESSAGE_FILTER_MAX_NAME_LENGTH} characters`,
      );
    }

    if (names.has(name.trim())) {
      throw policyValidationError(`'${rulePath}/name' duplicates another rule name in this layer`);
    }

    names.add(name.trim());

    if (typeof rule['pattern'] !== 'string' || !rule['pattern']) {
      throw policyValidationError(`'${rulePath}/pattern' must be a non-empty string`);
    }

    if (rule['flags'] !== undefined && typeof rule['flags'] !== 'string') {
      throw policyValidationError(`'${rulePath}/flags' must be a string`);
    }

    try {
      compileMessageFilterPattern(rule['pattern'], normalizeMessageFilterFlags(rule['flags'] as string | undefined));
    } catch (error) {
      throw policyValidationError(`'${rulePath}': ${(error as Error).message}`);
    }

    if (
      rule['direction'] !== undefined &&
      !(MESSAGE_FILTER_DIRECTIONS as readonly unknown[]).includes(rule['direction'])
    ) {
      throw policyValidationError(`'${rulePath}/direction' must be one of: ${MESSAGE_FILTER_DIRECTIONS.join(', ')}`);
    }

    if (!(MESSAGE_FILTER_ACTIONS as readonly unknown[]).includes(rule['action'])) {
      throw policyValidationError(`'${rulePath}/action' must be one of: ${MESSAGE_FILTER_ACTIONS.join(', ')}`);
    }

    if (rule['action'] === 'replace' && typeof rule['replacement'] !== 'string') {
      throw policyValidationError(`'${rulePath}/replacement' is required when action is replace`);
    }

    if (
      rule['replacement'] !== undefined &&
      (typeof rule['replacement'] !== 'string' || rule['replacement'].length > MESSAGE_FILTER_MAX_REPLACEMENT_LENGTH)
    ) {
      throw policyValidationError(
        `'${rulePath}/replacement' must be a string of at most ${MESSAGE_FILTER_MAX_REPLACEMENT_LENGTH} characters`,
      );
    }

    if (rule['enabled'] !== undefined && typeof rule['enabled'] !== 'boolean') {
      throw policyValidationError(`'${rulePath}/enabled' must be a boolean`);
    }
  }
}

/**
 * Resolve effective rules (global → workspace → environment). Invalid rules are skipped
 * defensively (writes are validated, but legacy / poisoned rows must not break chat).
 */
export function resolveEffectiveMessageFilters(
  layers: readonly PlatformPolicyLayerInput[],
): EffectiveMessageFilterRule[] {
  const rules: EffectiveMessageFilterRule[] = [];

  for (const layer of orderPolicyLayersHighToLow(layers)) {
    const overlay = isPlainPolicyObject(layer.overlay) ? layer.overlay : {};
    const list = overlay[MESSAGE_FILTERS_CONFIG_ROOT];

    if (!Array.isArray(list)) {
      continue;
    }

    for (const raw of list) {
      if (!isPlainPolicyObject(raw)) {
        continue;
      }

      try {
        assertValidMessageFilters([raw]);
      } catch {
        continue;
      }

      const rule = raw as unknown as MessageFilterRuleConfig;
      const flags = normalizeMessageFilterFlags(rule.flags);
      const effective: EffectiveMessageFilterRule = {
        name: rule.name.trim(),
        pattern: rule.pattern,
        flags,
        direction: rule.direction ?? 'bidirectional',
        action: rule.action,
        enabled: rule.enabled !== false,
        source: layer.source,
        ...(rule.action === 'replace' ? { replacement: rule.replacement ?? '' } : {}),
      };
      const duplicate = rules.some(
        (existing) =>
          existing.pattern === effective.pattern &&
          existing.flags === effective.flags &&
          existing.direction === effective.direction &&
          existing.action === effective.action &&
          existing.replacement === effective.replacement,
      );

      if (!duplicate) {
        rules.push(effective);
      }
    }
  }

  return rules;
}

/**
 * Defensive normalization of effective rules received over the wire (agent manager boundary):
 * re-validates every rule, drops invalid / unsafe ones, keeps order.
 */
export function normalizeEffectiveMessageFilters(raw: unknown): EffectiveMessageFilterRule[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const rules: EffectiveMessageFilterRule[] = [];
  const layers = new Set<string>(['global', 'workspace', 'environment']);

  for (const item of raw.slice(0, MESSAGE_FILTER_MAX_RULES_PER_LAYER * 3)) {
    if (!isPlainPolicyObject(item)) {
      continue;
    }

    const candidate = {
      name: item['name'],
      pattern: item['pattern'],
      flags: item['flags'],
      direction: item['direction'],
      action: item['action'],
      ...(item['replacement'] !== undefined ? { replacement: item['replacement'] } : {}),
      enabled: item['enabled'],
    };

    try {
      assertValidMessageFilters([candidate]);
    } catch {
      continue;
    }

    rules.push({
      name: String(candidate.name).trim(),
      pattern: candidate.pattern as string,
      flags: normalizeMessageFilterFlags(candidate.flags as string | undefined),
      direction: (candidate.direction as MessageFilterDirection | undefined) ?? 'bidirectional',
      action: candidate.action as MessageFilterAction,
      ...(candidate.action === 'replace' ? { replacement: (candidate.replacement as string | undefined) ?? '' } : {}),
      enabled: candidate.enabled !== false,
      source:
        typeof item['source'] === 'string' && layers.has(item['source'])
          ? (item['source'] as PlatformPolicyLayer)
          : 'global',
    });
  }

  return rules;
}

function appliesToDirection(rule: EffectiveMessageFilterRule, direction: 'incoming' | 'outgoing'): boolean {
  return rule.direction === 'bidirectional' || rule.direction === direction;
}

function matches(rule: EffectiveMessageFilterRule, message: string): boolean {
  // Fresh RegExp per test: global / sticky flags keep lastIndex state between calls.
  return compileMessageFilterPattern(rule.pattern, rule.flags).test(message);
}

/**
 * Evaluate effective rules for one message. Most restrictive outcome wins (drop > replace > flag).
 */
export function evaluateMessageFilters(
  rules: readonly EffectiveMessageFilterRule[],
  message: string,
  direction: 'incoming' | 'outgoing',
): MessageFilterEvaluation {
  const applicable = rules.filter((rule) => rule.enabled && appliesToDirection(rule, direction));
  const matchedRules: EffectiveMessageFilterRule[] = [];

  for (const rule of applicable) {
    try {
      if (matches(rule, message)) {
        matchedRules.push(rule);
      }
    } catch {
      // Invalid rules never break chat; they are rejected on write.
    }
  }

  const drop = matchedRules.find((rule) => rule.action === 'drop');

  if (drop) {
    return { status: 'dropped', matchedRule: drop, matchedRules };
  }

  const replacements = matchedRules.filter((rule) => rule.action === 'replace');

  if (replacements.length > 0) {
    let modified = message;

    for (const rule of replacements) {
      try {
        modified = modified.replace(compileMessageFilterPattern(rule.pattern, rule.flags), rule.replacement ?? '');
      } catch {
        // skip
      }
    }

    return { status: 'filtered', matchedRule: replacements[0], modifiedMessage: modified, matchedRules };
  }

  const flag = matchedRules.find((rule) => rule.action === 'flag');

  if (flag) {
    return { status: 'filtered', matchedRule: flag, matchedRules };
  }

  return { status: 'allowed', matchedRules };
}

/** Human-readable reason for a matched rule (used in chat drop notices and audit records). */
export function describeMessageFilterRule(rule: Pick<EffectiveMessageFilterRule, 'name' | 'source'>): string {
  return `${rule.name} (${rule.source})`;
}
