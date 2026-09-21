import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

import { BILLING_SEARCH_FIELDS, type BillingSearchEntityType } from './billing-search.types';

/** Maps OpenSearch document field names to SQL column expressions (allowlisted via BILLING_SEARCH_FIELDS). */
const SEARCH_FIELD_COLUMNS: Partial<
  Record<BillingSearchEntityType, Record<string, (alias: string) => string | undefined>>
> = {
  subscriptions: {
    number: (a) => `${a}.number`,
    status: (a) => `${a}.status::text`,
    userId: (a) => `CAST(${a}.user_id AS text)`,
    id: (a) => `CAST(${a}.id AS text)`,
  },
  invoices: {
    invoiceNumber: (a) => `${a}.invoice_number`,
    status: (a) => `${a}.status::text`,
    userId: (a) => `CAST(${a}.user_id AS text)`,
    id: (a) => `CAST(${a}.id AS text)`,
  },
  projects: {
    name: (a) => `${a}.name`,
    description: (a) => `${a}.description`,
    status: (a) => `${a}.status::text`,
    userId: (a) => `CAST(${a}.user_id AS text)`,
    id: (a) => `CAST(${a}.id AS text)`,
  },
  tickets: {
    title: (a) => `${a}.title`,
    content: (a) => `${a}.content`,
    status: (a) => `${a}.status::text`,
    priority: (a) => `${a}.priority::text`,
    projectId: (a) => `CAST(${a}.project_id AS text)`,
    id: (a) => `CAST(${a}.id AS text)`,
  },
  milestones: {
    name: (a) => `${a}.name`,
    description: (a) => `${a}.description`,
    projectId: (a) => `CAST(${a}.project_id AS text)`,
    id: (a) => `CAST(${a}.id AS text)`,
  },
  promotions: {
    code: (a) => `${a}.code`,
    name: (a) => `${a}.name`,
    description: (a) => `${a}.description`,
    id: (a) => `CAST(${a}.id AS text)`,
  },
  'customer-profiles': {
    customerNumber: (a) => `${a}.customer_number`,
    firstName: (a) => `${a}.first_name`,
    lastName: (a) => `${a}.last_name`,
    company: (a) => `${a}.company`,
    email: (a) => `${a}.email`,
    city: (a) => `${a}.city`,
    country: (a) => `${a}.country`,
    vatId: (a) => `${a}.vat_id`,
    userId: (a) => `CAST(${a}.user_id AS text)`,
    id: (a) => `CAST(${a}.id AS text)`,
  },
  'service-plans': {
    name: (a) => `${a}.name`,
    description: (a) => `${a}.description`,
    id: (a) => `CAST(${a}.id AS text)`,
  },
  'service-types': {
    key: (a) => `${a}.key`,
    name: (a) => `${a}.name`,
    description: (a) => `${a}.description`,
    provider: (a) => `${a}.provider`,
    id: (a) => `CAST(${a}.id AS text)`,
  },
  meters: {
    key: (a) => `${a}.key`,
    name: (a) => `${a}.name`,
    description: (a) => `${a}.description`,
    unitLabel: (a) => `${a}.unit_label`,
    id: (a) => `CAST(${a}.id AS text)`,
  },
  addons: {
    key: (a) => `${a}.key`,
    name: (a) => `${a}.name`,
    description: (a) => `${a}.description`,
    id: (a) => `CAST(${a}.id AS text)`,
  },
  'cloud-init-configs': {
    key: (a) => `${a}.key`,
    name: (a) => `${a}.name`,
    description: (a) => `${a}.description`,
    provisioningMode: (a) => `${a}.provisioning_mode`,
    id: (a) => `CAST(${a}.id AS text)`,
  },
  'datev-exports': {
    fileName: (a) => `${a}.file_name`,
    status: (a) => `${a}.status::text`,
    scope: (a) => `${a}.scope::text`,
    periodYear: (a) => `CAST(${a}.period_year AS text)`,
    periodMonth: (a) => `CAST(${a}.period_month AS text)`,
    id: (a) => `CAST(${a}.id AS text)`,
  },
  backorders: {
    status: (a) => `${a}.status::text`,
    failureReason: (a) => `${a}.failure_reason`,
    userId: (a) => `CAST(${a}.user_id AS text)`,
    planId: (a) => `CAST(${a}.plan_id AS text)`,
    serviceTypeId: (a) => `CAST(${a}.service_type_id AS text)`,
    id: (a) => `CAST(${a}.id AS text)`,
  },
  offers: {
    offerNumber: (a) => `${a}.offer_number`,
    status: (a) => `${a}.status::text`,
    userId: (a) => `CAST(${a}.user_id AS text)`,
    id: (a) => `CAST(${a}.id AS text)`,
  },
};

/**
 * Applies ILIKE OR clauses for allowlisted search document fields. Joined columns (e.g. planName)
 * can be supplied via `joinedColumns`.
 */
export function applyBillingSearchIlike<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  entityType: BillingSearchEntityType,
  alias: string,
  search: string,
  joinedColumns?: Record<string, string>,
): void {
  const trimmed = search.trim();

  if (!trimmed) {
    return;
  }

  const allowlisted = BILLING_SEARCH_FIELDS[entityType];
  const columnMap = SEARCH_FIELD_COLUMNS[entityType] ?? {};
  const term = `%${trimmed}%`;
  const clauses: string[] = [];

  for (const field of allowlisted) {
    const joined = joinedColumns?.[field];

    if (joined) {
      clauses.push(`${joined} ILIKE :billingSearchTerm`);
      continue;
    }

    const resolve = columnMap[field];

    if (resolve) {
      const column = resolve(alias);

      if (column) {
        clauses.push(`${column} ILIKE :billingSearchTerm`);
      }
    }
  }

  if (clauses.length === 0) {
    return;
  }

  qb.andWhere(`(${clauses.join(' OR ')})`, { billingSearchTerm: term });
}
