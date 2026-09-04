export const BILLING_SEARCH_ENTITY_TYPES = [
  'subscriptions',
  'invoices',
  'projects',
  'tickets',
  'promotions',
  'customer-profiles',
  'service-plans',
  'service-types',
  'meters',
  'addons',
  'cloud-init-configs',
  'datev-exports',
  'time-entries',
  'milestones',
  'users',
  'backorders',
  'offers',
] as const;

export type BillingSearchEntityType = (typeof BILLING_SEARCH_ENTITY_TYPES)[number];

export interface BillingSearchDocument {
  id: string;
  tenantId: string;
  entityType: BillingSearchEntityType;
  [key: string]: string | number | boolean | null | undefined;
}

export const BILLING_SEARCH_FIELDS: Record<BillingSearchEntityType, string[]> = {
  subscriptions: ['number', 'status', 'planName', 'userEmail', 'userId', 'id'],
  invoices: ['invoiceNumber', 'subscriptionNumber', 'userEmail', 'status', 'userId', 'id'],
  projects: ['name', 'description', 'status', 'userId', 'id'],
  tickets: ['title', 'content', 'status', 'priority', 'projectId', 'id'],
  promotions: ['code', 'name', 'description', 'id'],
  'customer-profiles': [
    'customerNumber',
    'firstName',
    'lastName',
    'company',
    'email',
    'city',
    'country',
    'vatId',
    'userId',
    'id',
  ],
  'service-plans': ['name', 'description', 'id'],
  'service-types': ['key', 'name', 'description', 'provider', 'id'],
  meters: ['key', 'name', 'description', 'unitLabel', 'id'],
  addons: ['key', 'name', 'description', 'id'],
  'cloud-init-configs': ['key', 'name', 'description', 'provisioningMode', 'id'],
  'datev-exports': ['fileName', 'status', 'scope', 'periodYear', 'periodMonth', 'id'],
  'time-entries': ['description', 'projectId', 'ticketId', 'recordedByUserId', 'id'],
  milestones: ['name', 'description', 'projectId', 'id'],
  users: ['email', 'role', 'id'],
  backorders: ['status', 'failureReason', 'userId', 'planId', 'serviceTypeId', 'id'],
  offers: ['offerNumber', 'status', 'userEmail', 'userId', 'id'],
};

export const BILLING_SEARCH_REINDEX_BATCH_SIZE = 100;

export interface BillingSearchIdsResult {
  ids: string[];
  total: number;
}

/** `null` means OpenSearch was skipped (disabled) or failed — callers should fall back. */
export type BillingSearchIdsLookup = BillingSearchIdsResult | null;
