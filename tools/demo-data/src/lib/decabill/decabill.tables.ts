import { DemoDeleteTarget, demoIdCondition } from '../core/seeder';

/** FK-safe insert order; resets delete in reverse. */
export const DECABILL_INSERT_ORDER = [
  'users',
  'user_personal_access_tokens',
  'billing_customer_profiles',
  'billing_service_types',
  'billing_meters',
  'billing_service_type_meters',
  'billing_cloud_init_configs',
  'billing_addons',
  'billing_addon_meters',
  'billing_service_plans',
  'billing_service_plan_meters',
  'billing_promotions',
  'billing_provider_price_snapshots',
  'billing_availability_snapshots',
  'billing_projects',
  'billing_project_milestones',
  'billing_project_tickets',
  'billing_project_ticket_comments',
  'billing_project_ticket_activities',
  'billing_subscriptions',
  'billing_subscription_items',
  'billing_reserved_hostnames',
  'billing_subscription_addons',
  'billing_subscription_config_changes',
  'billing_usage_records',
  'billing_backorders',
  'billing_promotion_redemptions',
  'billing_offers',
  'billing_offer_line_items',
  'billing_invoices',
  'billing_invoice_line_items',
  'billing_invoice_promotion_applications',
  'billing_payment_attempts',
  'billing_payment_refunds',
  'billing_project_time_entries',
  'billing_open_positions',
  'billing_supplier_profiles',
  'billing_supplier_contracts',
  'billing_supplier_invoices',
  'billing_supplier_invoice_line_items',
  'billing_datev_debtor_accounts',
  'billing_datev_creditor_accounts',
  'billing_datev_exports',
  'billing_oss_threshold_ledgers',
  'billing_audit_logs',
  'webhook_endpoints',
  'webhook_deliveries',
  'email_deliveries',
] as const;

/** Tables whose unique keys may collide with real data; conflicting demo rows are skipped. */
export const DECABILL_SKIP_ON_CONFLICT = new Set<string>([
  'billing_datev_debtor_accounts',
  'billing_datev_creditor_accounts',
  'billing_datev_exports',
  'billing_oss_threshold_ledgers',
]);

/**
 * Rows the running app may have created for demo users or on demo catalog entries (orders,
 * invoices, redemptions, …). They have regular ids and would otherwise block the RESTRICT /
 * NO ACTION foreign keys when demo parents are deleted.
 */
const DECABILL_APP_CREATED_TARGETS: readonly DemoDeleteTarget[] = [
  {
    table: 'billing_invoice_promotion_applications',
    where:
      'redemption_id IN (SELECT id FROM billing_promotion_redemptions WHERE ' +
      ['id', 'user_id', 'subscription_id', 'promotion_id'].map(demoIdCondition).join(' OR ') +
      ')',
  },
  { table: 'billing_promotion_redemptions', column: 'user_id' },
  { table: 'billing_promotion_redemptions', column: 'promotion_id' },
  { table: 'billing_subscription_addons', column: 'addon_id' },
  { table: 'billing_usage_records', column: 'meter_id' },
  { table: 'billing_usage_records', column: 'addon_id' },
  { table: 'billing_service_plan_meters', column: 'meter_id' },
  { table: 'billing_service_type_meters', column: 'meter_id' },
  { table: 'billing_addon_meters', column: 'meter_id' },
  { table: 'billing_open_positions', column: 'user_id' },
  { table: 'billing_invoices', column: 'user_id' },
  { table: 'billing_subscription_items', column: 'service_type_id' },
  { table: 'billing_subscriptions', column: 'user_id' },
  { table: 'billing_subscriptions', column: 'plan_id' },
  { table: 'billing_backorders', column: 'user_id' },
  { table: 'billing_projects', column: 'user_id' },
  { table: 'billing_offers', column: 'user_id' },
  { table: 'billing_customer_profiles', column: 'user_id' },
  { table: 'billing_datev_debtor_accounts', column: 'user_id' },
  { table: 'billing_supplier_invoices', column: 'supplier_id' },
  { table: 'billing_supplier_contracts', column: 'supplier_id' },
  { table: 'billing_datev_creditor_accounts', column: 'supplier_id' },
  { table: 'billing_audit_logs', column: 'user_id' },
];

export const DECABILL_DELETE_TARGETS: readonly DemoDeleteTarget[] = [
  ...DECABILL_APP_CREATED_TARGETS,
  ...[...DECABILL_INSERT_ORDER].reverse().map((table) => ({ table })),
];

/** Tables that must exist before seeding (i.e. the API container has run its migrations). */
export const DECABILL_REQUIRED_TABLES = [
  'users',
  'billing_subscriptions',
  'billing_invoices',
  'billing_offers',
  'billing_projects',
  'billing_supplier_invoices',
  'billing_stored_files',
  'webhook_endpoints',
];
