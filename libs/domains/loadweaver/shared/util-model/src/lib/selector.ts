import { z } from 'zod';

import { labelKeySchema, labelsSchema, labelValueSchema, resourceNameSchema, type Labels } from './metadata';

export const selectorOperatorSchema = z.enum(['In', 'NotIn', 'Exists', 'DoesNotExist']);
export type SelectorOperator = z.infer<typeof selectorOperatorSchema>;

export const selectorExpressionSchema = z
  .object({
    key: labelKeySchema,
    operator: selectorOperatorSchema,
    values: z.array(labelValueSchema).optional(),
  })
  .superRefine((expr, ctx) => {
    const needsValues = expr.operator === 'In' || expr.operator === 'NotIn';

    if (needsValues && (!expr.values || expr.values.length === 0)) {
      ctx.addIssue({ code: 'custom', message: `operator ${expr.operator} requires values` });
    }

    if (!needsValues && expr.values && expr.values.length > 0) {
      ctx.addIssue({ code: 'custom', message: `operator ${expr.operator} does not take values` });
    }
  });
export type SelectorExpression = z.infer<typeof selectorExpressionSchema>;

/**
 * Label selector (P4, 3.3). All given conditions must hold (AND).
 * `names` is the static-membership shortcut: "static membership is just a selector on the name".
 * An empty selector matches everything.
 */
export const selectorSchema = z.object({
  names: z.array(resourceNameSchema).optional(),
  matchLabels: labelsSchema.optional(),
  matchExpressions: z.array(selectorExpressionSchema).optional(),
});
export type Selector = z.infer<typeof selectorSchema>;

/** Anything a selector can be evaluated against. */
export interface Selectable {
  name: string;
  labels?: Labels;
}

export function matchesSelector(selector: Selector, target: Selectable): boolean {
  const labels = target.labels ?? {};

  if (selector.names && !selector.names.includes(target.name)) {
    return false;
  }

  for (const [key, value] of Object.entries(selector.matchLabels ?? {})) {
    if (labels[key] !== value) {
      return false;
    }
  }

  for (const expr of selector.matchExpressions ?? []) {
    const has = Object.prototype.hasOwnProperty.call(labels, expr.key);
    const value = labels[expr.key];

    switch (expr.operator) {
      case 'In':
        if (!has || !(expr.values ?? []).includes(value)) return false;
        break;
      case 'NotIn':
        if (has && (expr.values ?? []).includes(value)) return false;
        break;
      case 'Exists':
        if (!has) return false;
        break;
      case 'DoesNotExist':
        if (has) return false;
        break;
    }
  }

  return true;
}

export function selectMatching<T extends Selectable>(selector: Selector, targets: readonly T[]): T[] {
  return targets.filter((target) => matchesSelector(selector, target));
}

/** Human readable form used in plans, e.g. `site=fra1,role in (ingress,edge)`. */
export function describeSelector(selector: Selector): string {
  const parts: string[] = [];

  if (selector.names) parts.push(`name in (${selector.names.join(',')})`);

  for (const [key, value] of Object.entries(selector.matchLabels ?? {})) parts.push(`${key}=${value}`);

  for (const expr of selector.matchExpressions ?? []) {
    switch (expr.operator) {
      case 'In':
        parts.push(`${expr.key} in (${(expr.values ?? []).join(',')})`);
        break;
      case 'NotIn':
        parts.push(`${expr.key} notin (${(expr.values ?? []).join(',')})`);
        break;
      case 'Exists':
        parts.push(expr.key);
        break;
      case 'DoesNotExist':
        parts.push(`!${expr.key}`);
        break;
    }
  }

  return parts.length > 0 ? parts.join(',') : '*';
}
