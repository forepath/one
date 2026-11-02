/**
 * No preselected country (DB-10): the first list entry ("Afghanistan") was a misleading default.
 * Country selects show a "Select country" placeholder; {@link withOptionalCountry} drops the empty value.
 */
export const DEFAULT_BILLING_COUNTRY_CODE = '';

/** Omits an empty country from a profile payload (the API accepts no country, but not an empty one). */
export function withOptionalCountry<T extends { country?: string | null }>(dto: T): T {
  if (dto.country?.trim()) {
    return dto;
  }

  const { country: _country, ...rest } = dto;

  return rest as T;
}
