/**
 * Coerce values from `type="number"` + ngModel (string | number | null) to a trimmed string.
 * Empty / null clears the optional override.
 */
export function optionalNumberInputValue(raw: string | number | null | undefined): string {
  if (raw == null || raw === '') {
    return '';
  }

  return String(raw).trim();
}

/**
 * Number from an `fpc-form-control` number input. The control reports its value as a string (`"2"`), so request
 * payloads must convert before sending: the backend validates numbers strictly. Empty, null or non-numeric → `null`.
 */
export function numberInputValue(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;

  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;

  const text = raw.trim().replace(',', '.');

  if (text === '') return null;

  const value = Number(text);

  return Number.isFinite(value) ? value : null;
}

/** Like {@link numberInputValue}, but `undefined` instead of `null` (optional DTO fields are omitted). */
export function optionalNumberInput(raw: string | number | null | undefined): number | undefined {
  return numberInputValue(raw) ?? undefined;
}

/** Like {@link numberInputValue} for required fields; empty / invalid falls back to `fallback`. */
export function requiredNumberInput(raw: string | number | null | undefined, fallback = 0): number {
  return numberInputValue(raw) ?? fallback;
}
