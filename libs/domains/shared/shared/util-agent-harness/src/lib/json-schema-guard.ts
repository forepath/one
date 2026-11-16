import type { JsonSchema } from './agent-harness.types';

/**
 * Minimal JSON schema check of tool arguments produced by the model: `type`, `required`, `properties`,
 * `additionalProperties: false`, `enum`, `const`, `items`, string length, numeric bounds and `anyOf` / `oneOf`.
 *
 * It is a guard, not a full validator: arguments are model output and must never be trusted. Use the tool's
 * `parse` hook (e.g. a zod schema's `parse`) for stronger, typed validation.
 */
export function validateAgainstSchema(value: unknown, schema: JsonSchema | undefined, path = '$'): string[] {
  if (!schema || typeof schema !== 'object') {
    return [];
  }

  const errors: string[] = [];
  const type = schema['type'];

  if (Array.isArray(schema['anyOf']) || Array.isArray(schema['oneOf'])) {
    const variants = (schema['anyOf'] ?? schema['oneOf']) as JsonSchema[];

    if (!variants.some((variant) => validateAgainstSchema(value, variant, path).length === 0)) {
      errors.push(`${path} does not match any allowed shape`);
    }
  }

  if (type !== undefined) {
    const types = Array.isArray(type) ? (type as string[]) : [type as string];

    if (!types.some((candidate) => matchesType(value, candidate))) {
      return [...errors, `${path} must be ${types.join(' or ')}`];
    }
  }

  if (Array.isArray(schema['enum']) && !(schema['enum'] as unknown[]).some((entry) => deepEqual(entry, value))) {
    errors.push(
      `${path} must be one of ${(schema['enum'] as unknown[]).map((entry) => JSON.stringify(entry)).join(', ')}`,
    );
  }

  if ('const' in schema && !deepEqual(schema['const'], value)) {
    errors.push(`${path} must be ${JSON.stringify(schema['const'])}`);
  }

  if (typeof value === 'string') {
    if (typeof schema['minLength'] === 'number' && value.length < schema['minLength']) {
      errors.push(`${path} must have at least ${schema['minLength']} characters`);
    }

    if (typeof schema['maxLength'] === 'number' && value.length > schema['maxLength']) {
      errors.push(`${path} must have at most ${schema['maxLength']} characters`);
    }

    if (typeof schema['pattern'] === 'string') {
      try {
        if (!new RegExp(schema['pattern'], 'u').test(value)) {
          errors.push(`${path} must match ${schema['pattern']}`);
        }
      } catch {
        // Invalid patterns are a schema bug; ignored like unknown keywords.
      }
    }
  }

  if (typeof value === 'number') {
    if (typeof schema['minimum'] === 'number' && value < schema['minimum']) {
      errors.push(`${path} must be >= ${schema['minimum']}`);
    }

    if (typeof schema['maximum'] === 'number' && value > schema['maximum']) {
      errors.push(`${path} must be <= ${schema['maximum']}`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema['minItems'] === 'number' && value.length < schema['minItems']) {
      errors.push(`${path} must have at least ${schema['minItems']} items`);
    }

    if (typeof schema['maxItems'] === 'number' && value.length > schema['maxItems']) {
      errors.push(`${path} must have at most ${schema['maxItems']} items`);
    }

    if (schema['items'] && typeof schema['items'] === 'object' && !Array.isArray(schema['items'])) {
      value.forEach((entry, index) => {
        errors.push(...validateAgainstSchema(entry, schema['items'] as JsonSchema, `${path}[${index}]`));
      });
    }
  }

  if (isPlainObject(value)) {
    const properties = isPlainObject(schema['properties']) ? (schema['properties'] as Record<string, JsonSchema>) : {};

    if (Array.isArray(schema['required'])) {
      for (const key of schema['required'] as string[]) {
        if (!(key in value) || value[key] === undefined) {
          errors.push(`${path}.${key} is required`);
        }
      }
    }

    for (const [key, entry] of Object.entries(value)) {
      if (key in properties) {
        errors.push(...validateAgainstSchema(entry, properties[key], `${path}.${key}`));
      } else if (schema['additionalProperties'] === false) {
        errors.push(`${path}.${key} is not allowed`);
      } else if (isPlainObject(schema['additionalProperties'])) {
        errors.push(...validateAgainstSchema(entry, schema['additionalProperties'] as JsonSchema, `${path}.${key}`));
      }
    }
  }

  return errors;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return isPlainObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
