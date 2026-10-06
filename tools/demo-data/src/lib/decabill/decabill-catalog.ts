import { json } from '../core/sql';

import { DEMO_PROVIDER, DecabillTenantContext, DemoCatalog, DemoPlan } from './decabill-context';

interface PlanSpec {
  name: string;
  description: string;
  price: number;
  intervalType: DemoPlan['intervalType'];
  intervalValue: number;
  serviceTypeKey: string | null;
  taxCategory?: DemoPlan['taxCategory'];
  billInAdvance?: boolean;
  isActive?: boolean;
  meters?: string[];
  highlights?: { icon: string; text: string }[];
  minCommitmentDays?: number;
  noticeDays?: number;
}

const SERVICE_TYPES = [
  {
    key: 'demo-cloud-server',
    name: 'Managed Cloud Server',
    description: 'Virtual server with managed updates, backups and monitoring.',
    isActive: true,
  },
  {
    key: 'demo-app-hosting',
    name: 'Application Hosting',
    description: 'Container based hosting for web applications with automatic TLS.',
    isActive: true,
  },
  {
    key: 'demo-legacy-vps',
    name: 'Legacy VPS',
    description: 'Discontinued VPS product line kept for existing contracts.',
    isActive: false,
  },
] as const;
const METERS = [
  { key: 'demo-traffic', name: 'Outbound traffic', unit: 'GB', aggregator: 'sum', price: 0.01, included: 1000 },
  { key: 'demo-cpu-hours', name: 'CPU hours', unit: 'h', aggregator: 'sum_positive_deltas', price: 0.004, included: 0 },
  { key: 'demo-storage', name: 'Block storage', unit: 'GB', aggregator: 'max', price: 0.05, included: 40 },
  { key: 'demo-api-calls', name: 'API calls', unit: '1k calls', aggregator: 'sum', price: 0.2, included: 50 },
] as const;
const PLANS: PlanSpec[] = [
  {
    name: 'Cloud Server S',
    description: '2 vCPU, 4 GB RAM, 40 GB NVMe',
    price: 9.9,
    intervalType: 'month',
    intervalValue: 1,
    serviceTypeKey: 'demo-cloud-server',
    meters: ['demo-traffic', 'demo-storage'],
    highlights: [
      { icon: 'cpu', text: '2 vCPU' },
      { icon: 'memory', text: '4 GB RAM' },
    ],
  },
  {
    name: 'Cloud Server M',
    description: '4 vCPU, 8 GB RAM, 80 GB NVMe',
    price: 19.9,
    intervalType: 'month',
    intervalValue: 1,
    serviceTypeKey: 'demo-cloud-server',
    meters: ['demo-traffic', 'demo-storage', 'demo-cpu-hours'],
    highlights: [
      { icon: 'cpu', text: '4 vCPU' },
      { icon: 'shield-check', text: 'Daily backups' },
    ],
  },
  {
    name: 'Cloud Server L (yearly)',
    description: '8 vCPU, 16 GB RAM, 160 GB NVMe, billed yearly',
    price: 399,
    intervalType: 'year',
    intervalValue: 1,
    serviceTypeKey: 'demo-cloud-server',
    billInAdvance: true,
    minCommitmentDays: 365,
    noticeDays: 30,
  },
  {
    name: 'App Hosting Starter',
    description: 'One container, 1 GB RAM, custom domain',
    price: 14.5,
    intervalType: 'month',
    intervalValue: 1,
    serviceTypeKey: 'demo-app-hosting',
    meters: ['demo-api-calls'],
  },
  {
    name: 'Build Runner (hourly)',
    description: 'On-demand CI runner billed per hour',
    price: 0.06,
    intervalType: 'hour',
    intervalValue: 1,
    serviceTypeKey: 'demo-app-hosting',
  },
  {
    name: 'Sandbox Day Pass',
    description: 'Temporary test environment billed per day',
    price: 1.2,
    intervalType: 'day',
    intervalValue: 1,
    serviceTypeKey: 'demo-app-hosting',
  },
  {
    name: 'Support Retainer',
    description: 'Eight hours of priority support per month',
    price: 490,
    intervalType: 'month',
    intervalValue: 1,
    serviceTypeKey: null,
    billInAdvance: true,
  },
  {
    name: 'Quarterly Maintenance',
    description: 'Security patching and quarterly health check',
    price: 750,
    intervalType: 'month',
    intervalValue: 3,
    serviceTypeKey: null,
  },
  {
    name: 'Knowledge Base Subscription',
    description: 'Digital publications (reduced VAT rate)',
    price: 29,
    intervalType: 'year',
    intervalValue: 1,
    serviceTypeKey: null,
    taxCategory: 'reduced',
  },
  {
    name: 'VPS Classic (discontinued)',
    description: 'Legacy plan, no longer orderable',
    price: 6.5,
    intervalType: 'month',
    intervalValue: 1,
    serviceTypeKey: 'demo-legacy-vps',
    isActive: false,
  },
];

export function buildCatalog(context: DecabillTenantContext): DemoCatalog {
  const { random, rows, encryptor, tenantId } = context;
  const createdAt = random.daysAgo(random.int(400, 500));
  const serviceTypeIds = new Map<string, string>();
  const meterIds = new Map<string, string>();

  for (const type of SERVICE_TYPES) {
    const id = random.id();

    serviceTypeIds.set(type.key, id);
    rows.add('billing_service_types', {
      id,
      key: type.key,
      tenant_id: tenantId,
      name: type.name,
      description: type.description,
      provider: DEMO_PROVIDER,
      allowed_providers: json([DEMO_PROVIDER]),
      config_schema: json({}),
      is_active: type.isActive,
      disallow_statutory_withdrawal: type.key === 'demo-app-hosting',
      provider_defaults: encryptor.encryptJson({}),
      created_at: createdAt,
      updated_at: createdAt,
    });
  }

  for (const meter of METERS) {
    const id = random.id();

    meterIds.set(meter.key, id);
    rows.add('billing_meters', {
      id,
      tenant_id: tenantId,
      key: meter.key,
      name: meter.name,
      description: `${meter.name} measured in ${meter.unit}`,
      unit_label: meter.unit,
      aggregator: meter.aggregator,
      default_unit_price_net: meter.price,
      default_included_usage: meter.included,
      is_active: meter.key !== 'demo-api-calls' || random.chance(0.5),
      created_at: createdAt,
      updated_at: createdAt,
    });
  }

  rows.add('billing_service_type_meters', {
    id: random.id(),
    service_type_id: serviceTypeIds.get('demo-cloud-server'),
    meter_id: meterIds.get('demo-traffic'),
    unit_price_net: null,
    included_usage: null,
    source: 'provider',
    required: true,
    created_at: createdAt,
    updated_at: createdAt,
  });

  const cloudInitId = random.id();

  rows.add('billing_cloud_init_configs', {
    id: cloudInitId,
    tenant_id: tenantId,
    key: 'demo-nginx',
    name: 'Static website (nginx)',
    provisioning_mode: 'simple',
    description: 'Serves a static website from an nginx container.',
    docker_image: 'nginx:1.27-alpine',
    container_port: 80,
    host_port: 80,
    work_dir: '/opt/custom-app',
    environment_variables: json([]),
    service_tabs: json([]),
    env_default_values: encryptor.encryptJson({}),
    is_active: true,
    created_at: createdAt,
    updated_at: createdAt,
  });
  rows.add('billing_cloud_init_configs', {
    id: random.id(),
    tenant_id: tenantId,
    key: 'demo-compose-stack',
    name: 'Compose stack (app + database)',
    provisioning_mode: 'compose-template',
    description: 'Application container with a PostgreSQL sidecar.',
    docker_image: null,
    docker_compose_template: [
      'services:',
      '  app:',
      '    image: ghcr.io/example/app:latest',
      '    ports: ["80:8080"]',
      '  db:',
      '    image: postgres:16-alpine',
    ].join('\n'),
    environment_variables: json([]),
    service_tabs: json([]),
    env_default_values: encryptor.encryptJson({}),
    is_active: false,
    created_at: createdAt,
    updated_at: createdAt,
  });

  const addons = [
    { key: 'demo-backup', name: 'Daily backups', price: 2.9 },
    { key: 'demo-monitoring', name: 'Uptime monitoring', price: 4.9 },
    { key: 'demo-ipv4', name: 'Additional IPv4 address', price: 0.9 },
  ].map((addon) => {
    const id = random.id();

    rows.add('billing_addons', {
      id,
      tenant_id: tenantId,
      key: addon.key,
      name: addon.name,
      description: `${addon.name} for managed servers.`,
      implementation_type: 'cloud_init_script',
      script_template: `#!/bin/sh\necho "${addon.key} enabled"`,
      deprovision_script_template: `#!/bin/sh\necho "${addon.key} disabled"`,
      config_schema: json({}),
      config_default_values: encryptor.encryptJson({}),
      compatible_providers: json([DEMO_PROVIDER]),
      base_price: addon.price,
      price_interval_type: 'month',
      price_interval_value: 1,
      is_active: true,
      created_at: createdAt,
      updated_at: createdAt,
    });

    return { id, name: addon.name, price: addon.price };
  });

  rows.add('billing_addon_meters', {
    id: random.id(),
    addon_id: addons[1].id,
    meter_id: meterIds.get('demo-api-calls'),
    unit_price_net: 0.15,
    included_usage: 10,
    source: 'manual',
    required: false,
    created_at: createdAt,
    updated_at: createdAt,
  });

  const plans = PLANS.map((spec): DemoPlan => {
    const id = random.id();
    const serviceTypeId = spec.serviceTypeKey ? (serviceTypeIds.get(spec.serviceTypeKey) ?? null) : null;
    const planMeterIds = (spec.meters ?? []).map((key) => meterIds.get(key) as string);

    rows.add('billing_service_plans', {
      id,
      service_type_id: serviceTypeId,
      tenant_id: tenantId,
      name: spec.name,
      description: spec.description,
      billing_interval_type: spec.intervalType,
      billing_interval_value: spec.intervalValue,
      billing_day_of_month: null,
      cancel_at_period_end: true,
      bill_in_advance: spec.billInAdvance ?? false,
      auto_recalculate_price_daily: false,
      min_commitment_days: spec.minCommitmentDays ?? 0,
      notice_days: spec.noticeDays ?? 0,
      base_price: spec.price,
      margin_percent: serviceTypeId ? 15 : null,
      margin_fixed: null,
      provider_config_defaults: json(
        serviceTypeId
          ? { serverType: 'demo-standard', location: 'fsn1', allowedAddonIds: addons.map((addon) => addon.id) }
          : {},
      ),
      ordering_highlights: json(spec.highlights ?? []),
      is_active: spec.isActive ?? true,
      allow_customer_location_selection: Boolean(serviceTypeId),
      allow_customer_server_type_selection: false,
      allowed_server_types: json([]),
      allow_customer_provider_selection: false,
      allowed_providers: json(serviceTypeId ? [DEMO_PROVIDER] : []),
      tax_category: spec.taxCategory ?? 'standard',
      created_at: createdAt,
      updated_at: createdAt,
    });

    for (const meterId of planMeterIds) {
      rows.add('billing_service_plan_meters', {
        id: random.id(),
        service_plan_id: id,
        meter_id: meterId,
        unit_price_net: null,
        included_usage: null,
        source: 'manual',
        required: false,
        created_at: createdAt,
        updated_at: createdAt,
      });
    }

    return {
      id,
      name: spec.name,
      price: spec.price,
      intervalType: spec.intervalType,
      intervalValue: spec.intervalValue,
      serviceTypeId,
      taxCategory: spec.taxCategory ?? 'standard',
      billInAdvance: spec.billInAdvance ?? false,
      isActive: spec.isActive ?? true,
      meterIds: planMeterIds,
    };
  });
  const promotions = buildPromotions(context, plans);

  return { plans, addons, promotions };
}

function buildPromotions(context: DecabillTenantContext, plans: DemoPlan[]): DemoCatalog['promotions'] {
  const { random, rows, tenantId } = context;
  const specs: Array<{
    code: string;
    name: string;
    type: string;
    config: Record<string, number>;
    from: number;
    to: number;
    active: boolean;
    eligibility: string;
    maxTotal?: number;
  }> = [
    {
      code: 'WELCOME10',
      name: 'Welcome discount',
      type: 'fixed_amount_net',
      config: { amountNet: 10 },
      from: -120,
      to: 120,
      active: true,
      eligibility: 'new',
    },
    {
      code: 'TRYMONTH',
      name: 'First month free',
      type: 'free_days',
      config: { days: 30 },
      from: -60,
      to: 60,
      active: true,
      eligibility: 'both',
    },
    {
      code: 'LOYAL2',
      name: 'Two periods on us',
      type: 'free_billing_periods',
      config: { periods: 2 },
      from: -200,
      to: 30,
      active: true,
      eligibility: 'existing',
      maxTotal: 3,
    },
    {
      code: 'SUMMER25',
      name: 'Summer sale (ended)',
      type: 'fixed_amount_net',
      config: { amountNet: 25 },
      from: -400,
      to: -300,
      active: true,
      eligibility: 'both',
    },
    {
      code: 'BLACKFRIDAY',
      name: 'Black Friday (upcoming)',
      type: 'free_days',
      config: { days: 14 },
      from: 40,
      to: 50,
      active: true,
      eligibility: 'new',
    },
    {
      code: 'PARTNER50',
      name: 'Partner discount (paused)',
      type: 'fixed_amount_net',
      config: { amountNet: 50 },
      from: -30,
      to: 300,
      active: false,
      eligibility: 'both',
    },
  ];

  return specs.map((spec) => {
    const id = random.id();
    const createdAt = random.daysAgo(Math.max(1, -spec.from) + 5);

    rows.add('billing_promotions', {
      id,
      tenant_id: tenantId,
      code: spec.code,
      name: spec.name,
      description: `${spec.name} — demo promotion`,
      redeemable_from: random.daysFromNow(spec.from),
      redeemable_to: random.daysFromNow(spec.to),
      max_total_redemptions: spec.maxTotal ?? null,
      max_per_user_redemptions: 1,
      is_active: spec.active,
      advantage_type: spec.type,
      advantage_config: json(spec.config),
      applicable_plan_ids: spec.code === 'LOYAL2' ? json(plans.slice(0, 2).map((plan) => plan.id)) : null,
      subscription_eligibility: spec.eligibility,
      created_at: createdAt,
      updated_at: createdAt,
    });

    return { id, code: spec.code, advantageType: spec.type, config: spec.config };
  });
}
