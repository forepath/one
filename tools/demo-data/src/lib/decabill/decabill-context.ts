import { ColumnEncryptor } from '../core/encryption';
import { PasswordHasher } from '../core/passwords';
import { DemoPerson } from '../core/people';
import { DemoRandom } from '../core/random';
import { RowCollector } from '../core/row-collector';
import { quoteLiteral, raw, SqlRaw } from '../core/sql';

import { BuyerTaxProfile, TaxCategory } from './decabill-tax';

export interface DecabillTenantContext {
  tenantId: string;
  /** `__shared__` unless TENANTS_SHARED_NUMBERS=false, then the tenant id. */
  numberScope: string;
  issuerCountry: string;
  emailDomain: string;
  random: DemoRandom;
  rows: RowCollector;
  encryptor: ColumnEncryptor;
  hasher: PasswordHasher;
  /** Shared across tenants: DATEV debtor/creditor numbers are unique per allocation scope. */
  datevCounters: { debtor: number; creditor: number };
}

export interface DemoCustomer extends BuyerTaxProfile {
  userId: string;
  email: string;
  person: DemoPerson;
  hasCompleteProfile: boolean;
  autoBilling: boolean;
}

export interface DemoPlan {
  id: string;
  name: string;
  price: number;
  intervalType: 'hour' | 'day' | 'month' | 'year';
  intervalValue: number;
  serviceTypeId: string | null;
  taxCategory: TaxCategory;
  billInAdvance: boolean;
  isActive: boolean;
  meterIds: string[];
}

export interface DemoCatalog {
  plans: DemoPlan[];
  addons: { id: string; name: string; price: number }[];
  promotions: { id: string; code: string; advantageType: string; config: Record<string, number> }[];
}

const DEMO_PROVIDER_LOCATIONS = [
  { location: 'fsn1', locationName: 'Falkenstein', datacenter: 'fsn1-dc14' },
  { location: 'nbg1', locationName: 'Nuremberg', datacenter: 'nbg1-dc3' },
  { location: 'hel1', locationName: 'Helsinki', datacenter: 'hel1-dc2' },
] as const;

/**
 * Provider id for demo server products. It is not a registered provisioning module, so the
 * provisioning job marks items active without creating remote resources, and live server-info
 * lookups fall back to the cached snapshot.
 */
export const DEMO_PROVIDER = 'demo';

export function pickDemoLocation(random: DemoRandom): (typeof DEMO_PROVIDER_LOCATIONS)[number] {
  return random.pick(DEMO_PROVIDER_LOCATIONS);
}

export function scopedNumber(prefix: string, table: string, scope: string, width: number): SqlRaw {
  const next = `pg_temp.demo_next_scoped(${quoteLiteral(table)}, ${quoteLiteral(scope)})`;

  return raw(`${quoteLiteral(`${prefix}-`)} || lpad(${next}::text, ${width}, '0')`);
}

export function yearlyNumber(prefix: string, table: string, scope: string, year: number): SqlRaw {
  const next = `pg_temp.demo_next_yearly(${quoteLiteral(table)}, ${quoteLiteral(scope)}, ${year})`;

  return raw(`${quoteLiteral(`${prefix}-${year}-`)} || lpad(${next}::text, 5, '0')`);
}

/**
 * DATEV account number: highest non-demo number in the allocation scope (or the start of the
 * default range) plus `offset`. The app allocates MAX+1, so real accounts continue afterwards.
 */
export function datevAccountNumber(kind: 'debtor' | 'creditor', scope: string, offset: number): SqlRaw {
  return raw(`pg_temp.demo_datev_number(${quoteLiteral(kind)}, ${quoteLiteral(scope)}, ${offset})`);
}

/**
 * Helper functions used inside the seed transaction to allocate document numbers from the
 * same sequence tables the API uses, so demo numbers never collide with real ones.
 */
export const DECABILL_NUMBER_FUNCTIONS_SQL = `
CREATE OR REPLACE FUNCTION pg_temp.demo_next_scoped(p_table text, p_scope text) RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE next_value integer;
BEGIN
  EXECUTE format(
    'INSERT INTO %I AS s (scope_key, last_value) VALUES ($1, 1)
     ON CONFLICT (scope_key) DO UPDATE SET last_value = s.last_value + 1 RETURNING last_value',
    p_table
  ) INTO next_value USING p_scope;
  RETURN next_value;
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.demo_next_yearly(p_table text, p_scope text, p_year integer) RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE next_value integer;
BEGIN
  EXECUTE format(
    'INSERT INTO %I AS s (tenant_id, year, last_value) VALUES ($1, $2, 1)
     ON CONFLICT (tenant_id, year) DO UPDATE SET last_value = s.last_value + 1 RETURNING last_value',
    p_table
  ) INTO next_value USING p_scope, p_year;
  RETURN next_value;
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.demo_datev_number(p_kind text, p_scope text, p_offset integer) RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE base_value integer;
BEGIN
  IF p_kind = 'debtor' THEN
    SELECT COALESCE(MAX(debtor_number), 9999) INTO base_value FROM billing_datev_debtor_accounts
      WHERE allocation_scope = p_scope AND id::text NOT LIKE '5eedda7a-%';
  ELSE
    SELECT COALESCE(MAX(creditor_number), 69999) INTO base_value FROM billing_datev_creditor_accounts
      WHERE allocation_scope = p_scope AND id::text NOT LIKE '5eedda7a-%';
  END IF;
  RETURN base_value + p_offset;
END
$fn$;
`;
