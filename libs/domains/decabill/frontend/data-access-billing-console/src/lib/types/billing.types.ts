// Types based on OpenAPI spec for Billing Service API

// Enums
export type BillingIntervalType = 'hour' | 'day' | 'month' | 'year';

export type SubscriptionStatus =
  | 'active'
  | 'pending_backorder'
  | 'pending_cancel'
  | 'pending_config_change'
  | 'pending_withdrawal'
  | 'pending_instant_cancel'
  | 'canceled';

export type BackorderStatus = 'pending' | 'retrying' | 'fulfilled' | 'cancelled' | 'failed';

export type UserRole = 'user' | 'admin';

// Provider details (GET /service-types/providers)
export interface ProviderEnvDefaultField {
  envKey: string;
  label: string;
  sensitive: boolean;
  type: 'string';
}

export type MeterAggregator = 'max' | 'min' | 'avg' | 'first' | 'last' | 'sum' | 'sum_positive_deltas';

export interface ProviderDetail {
  id: string;
  displayName: string;
  configSchema?: Record<string, unknown>;
  envDefaultFields?: ProviderEnvDefaultField[];
  supportsAddons?: boolean;
  supportsServerTypeUpgrade?: boolean;
  supportsServerTypeDowngrade?: boolean;
  /**
   * Interchangeability key for multi-provider service types.
   * Missing/empty ⇒ provider is only compatible with itself (`self:{id}`).
   */
  compatibilityGroup?: string;
  /** Required meters declared by the provider implementation. */
  meters?: DeclaredMeterDefinition[];
}

export interface DeclaredMeterDefinition {
  key: string;
  name: string;
  description?: string;
  unitLabel?: string;
  aggregator: MeterAggregator;
  defaultUnitPriceNet: number;
  defaultIncludedUsage?: number;
  /** When set, the meter-collect job pulls on this interval (ms). */
  collectionIntervalMs?: number;
}

export interface AddonModuleDetail {
  key: string;
  displayName: string;
  meters: DeclaredMeterDefinition[];
}

// Provider server type with specs and pricing (GET .../providers/:id/server-types)
export interface ServerType {
  id: string;
  name: string;
  cores: number;
  memory: number;
  disk: number;
  priceMonthly?: number;
  priceHourly?: number;
  description?: string;
}

// Provider geography option (GET .../providers/:id/locations)
export interface ProviderLocation {
  id: string;
  name: string;
  city?: string;
  country?: string;
}

// Statutory withdrawal
export interface WithdrawalPolicy {
  periodDays: number;
  allowedAfterProvisioning: boolean;
  unprovisionedAlwaysWithdrawable: true;
  provisionedRefundPolicy: 'unused_period_prorated';
}

export interface WithdrawalEligibility {
  canWithdraw: boolean;
  phase: string;
  deadline?: string;
  reason?: string;
  estimatedRefundGross?: number;
}

export interface WithdrawalResult {
  refundNet?: number;
  refundGross?: number;
  creditNoteNumber?: string;
  paymentRefundStatus: 'not_applicable' | 'pending' | 'succeeded' | 'failed';
}

// Service Types
export interface ServiceTypeResponse {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  /** Primary provider id; null when None (no cloud provider). */
  provider: string | null;
  /** Interchangeable provider ids (first is primary). Empty means None. */
  allowedProviders: string[];
  configSchema: Record<string, unknown>;
  disallowStatutoryWithdrawal: boolean;
  isActive: boolean;
  providerDefaultsConfigured?: Record<string, boolean>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateServiceTypeDto {
  key: string;
  name: string;
  description?: string;
  /**
   * Primary provider id (first of allowedProviders). Null/empty with empty allowedProviders means None.
   * When omitted, derived from allowedProviders[0].
   */
  provider?: string | null;
  /** Interchangeable provider ids (order preserved; first is primary). Empty means None. */
  allowedProviders?: string[];
  configSchema?: Record<string, unknown>;
  disallowStatutoryWithdrawal?: boolean;
  isActive?: boolean;
  providerDefaults?: Record<string, string>;
}

export interface UpdateServiceTypeDto {
  name?: string;
  description?: string;
  provider?: string | null;
  allowedProviders?: string[];
  configSchema?: Record<string, unknown>;
  disallowStatutoryWithdrawal?: boolean;
  isActive?: boolean;
  providerDefaults?: Record<string, string>;
}

// CloudInit Configs
export type CloudInitProvisioningMode = 'simple' | 'compose-template' | 'user-data-template';

export interface CloudInitConfigEnvVariableDefinition {
  key: string;
  label: string;
  description?: string;
  showInOrderForm: boolean;
  hasDefault: boolean;
  useRandomDefault?: boolean;
  randomDefaultLength?: number;
  randomDefaultSpecialChars?: boolean;
}

export interface CloudInitConfigServiceTabDefinition {
  id: string;
  label: string;
  order: number;
}

export interface CloudInitConfigResponse {
  id: string;
  key: string;
  name: string;
  provisioningMode: CloudInitProvisioningMode;
  description?: string | null;
  dockerImage?: string | null;
  containerPort: number;
  hostPort: number;
  workDir: string;
  dockerComposeTemplate?: string | null;
  userDataTemplate?: string | null;
  environmentVariables: CloudInitConfigEnvVariableDefinition[];
  serviceTabs?: CloudInitConfigServiceTabDefinition[];
  defaultValues?: Record<string, string>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CloudInitConfigOrderField {
  key: string;
  label: string;
  description?: string | null;
  required: boolean;
  hasDefault: boolean;
}

export type PlanProvisioningOption =
  | { type: 'integrated'; service: 'agenstra-controller' | 'agenstra-manager' | 'decabill-billing' }
  | { type: 'custom'; cloudInitConfigId: string };

export interface OrderProvisioningOption {
  optionKey: string;
  type: 'integrated' | 'custom';
  service?: 'agenstra-controller' | 'agenstra-manager' | 'decabill-billing';
  cloudInitConfigId?: string;
  label: string;
  description?: string | null;
}

export interface CreateCloudInitConfigDto {
  key: string;
  name: string;
  description?: string;
  provisioningMode?: CloudInitProvisioningMode;
  dockerImage?: string;
  containerPort?: number;
  hostPort?: number;
  workDir?: string;
  dockerComposeTemplate?: string;
  userDataTemplate?: string;
  environmentVariables?: Array<{
    key: string;
    label: string;
    description?: string;
    showInOrderForm: boolean;
    useRandomDefault?: boolean;
    randomDefaultLength?: number;
    randomDefaultSpecialChars?: boolean;
  }>;
  serviceTabs?: CloudInitConfigServiceTabDefinition[];
  defaultValues?: Record<string, string>;
  isActive?: boolean;
}

export interface UpdateCloudInitConfigDto {
  name?: string;
  description?: string;
  provisioningMode?: CloudInitProvisioningMode;
  dockerImage?: string;
  containerPort?: number;
  hostPort?: number;
  workDir?: string;
  dockerComposeTemplate?: string | null;
  userDataTemplate?: string | null;
  environmentVariables?: Array<{
    key: string;
    label: string;
    description?: string;
    showInOrderForm: boolean;
    useRandomDefault?: boolean;
    randomDefaultLength?: number;
    randomDefaultSpecialChars?: boolean;
  }>;
  serviceTabs?: CloudInitConfigServiceTabDefinition[];
  defaultValues?: Record<string, string>;
  isActive?: boolean;
}

// Addons
export type AddonImplementationType = 'module' | 'cloud_init_script';

/** Same shape as CloudInit env vars; stored under addon `configSchema.environmentVariables`. */
export type AddonConfigEnvVariableDefinition = CloudInitConfigEnvVariableDefinition;

/** Admin write payload (server derives `hasDefault`). */
export type AddonConfigEnvVariableInput = Omit<CloudInitConfigEnvVariableDefinition, 'hasDefault'> & {
  hasDefault?: boolean;
};

export interface AddonConfigSchema {
  environmentVariables: AddonConfigEnvVariableDefinition[];
}

export interface AddonConfigSchemaInput {
  environmentVariables: AddonConfigEnvVariableInput[];
}

export type AddonConfigOrderField = CloudInitConfigOrderField;

export interface AddonResponse {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  implementationType: AddonImplementationType;
  moduleKey?: string | null;
  scriptTemplate?: string | null;
  deprovisionScriptTemplate?: string | null;
  configSchema: AddonConfigSchema | Record<string, unknown>;
  /** Decrypted defaults; only on admin GET by id / create / update. */
  defaultValues?: Record<string, string>;
  compatibleProviders: string[];
  basePrice?: string | null;
  priceIntervalType?: BillingIntervalType | null;
  priceIntervalValue?: number | null;
  isActive: boolean;
  meters?: AttachedMeterResponse[];
  createdAt: string;
  updatedAt: string;
}

// Usage meters
export type UsageAttachmentType = 'plan' | 'addon';

export interface MeterResponse {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  unitLabel?: string | null;
  aggregator: MeterAggregator;
  defaultUnitPriceNet: number;
  defaultIncludedUsage: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMeterDto {
  key: string;
  name: string;
  description?: string;
  unitLabel?: string;
  aggregator: MeterAggregator;
  defaultUnitPriceNet: number;
  defaultIncludedUsage?: number;
  isActive?: boolean;
}

export interface UpdateMeterDto {
  name?: string;
  description?: string | null;
  unitLabel?: string | null;
  aggregator?: MeterAggregator;
  defaultUnitPriceNet?: number;
  defaultIncludedUsage?: number;
  isActive?: boolean;
}

export interface AttachedMeterResponse {
  meterId: string;
  key: string;
  name: string;
  description?: string | null;
  unitLabel?: string | null;
  aggregator: MeterAggregator;
  defaultUnitPriceNet: number;
  unitPriceNetOverride?: number | null;
  effectiveUnitPriceNet: number;
  defaultIncludedUsage: number;
  includedUsageOverride?: number | null;
  effectiveIncludedUsage: number;
  isActive: boolean;
  source?: 'manual' | 'module' | 'provider';
  required?: boolean;
  /** True when listed on a plan but sourced from the plan's service type. */
  inherited?: boolean;
}

export interface AttachMeterDto {
  meterId: string;
  unitPriceNet?: number | null;
  includedUsage?: number | null;
}

export interface UpdateAttachedMeterDto {
  unitPriceNet?: number | null;
  includedUsage?: number | null;
}

export interface SubscriptionMeterSummary {
  meterId: string;
  key: string;
  name: string;
  unitLabel?: string | null;
  aggregator: MeterAggregator;
  attachmentType: UsageAttachmentType;
  addonId?: string | null;
  addonName?: string | null;
  effectiveUnitPriceNet: number;
  effectiveIncludedUsage: number;
  aggregatedValue: number;
  billableValue: number;
  estimatedChargeNet: number;
  entryCount: number;
  periodStart?: string | null;
  periodEnd?: string | null;
}

export interface MeterHistorySeriesPoint {
  period: string;
  value: number;
}

export interface MeterHistorySeries {
  meterId: string;
  key: string;
  name: string;
  unitLabel?: string | null;
  aggregator: MeterAggregator;
  attachmentType: UsageAttachmentType;
  addonId?: string | null;
  addonName?: string | null;
  series: MeterHistorySeriesPoint[];
  totalValue: number;
}

export type MeterHistoryGroupBy = 'day' | 'month';

export interface MeterHistoryFilters {
  from: string;
  to: string;
  groupBy: MeterHistoryGroupBy;
}

export interface SubscriptionMeterHistory {
  subscriptionId: string;
  from: string;
  to: string;
  groupBy: MeterHistoryGroupBy;
  meters: MeterHistorySeries[];
}

/** Payload of billing WebSocket `meterSummaryUpdate`. */
export interface BillingMeterSummaryUpdatePayload {
  subscriptionId: string;
  generatedAt: string;
  meters: SubscriptionMeterSummary[];
}

export interface UsageMeterEntryResponse {
  id: string;
  subscriptionId: string;
  meterId: string;
  value: number;
  attachmentType: UsageAttachmentType;
  addonId?: string | null;
  periodStart: string;
  periodEnd: string;
  usageSource: string;
  usagePayload: Record<string, unknown>;
  createdAt: string;
}

export interface CreateUsageMeterEntryDto {
  meterId: string;
  value: number;
  attachmentType?: UsageAttachmentType;
  addonId?: string;
  periodStart: string;
  periodEnd: string;
  usagePayload?: Record<string, unknown>;
}

export interface UpdateUsageMeterEntryDto {
  meterId?: string;
  value?: number;
  attachmentType?: UsageAttachmentType;
  addonId?: string | null;
  periodStart?: string;
  periodEnd?: string;
  usagePayload?: Record<string, unknown>;
}

export interface PlanAddonOptionDto {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  implementationType: AddonImplementationType;
  basePrice?: string | null;
  priceIntervalType?: BillingIntervalType | null;
  priceIntervalValue?: number | null;
  periodPrice: number;
  /** Customer-visible config fields (no secret values). */
  orderFields: AddonConfigOrderField[];
  /** Attached usage meters (read-only on customer order). */
  meters?: AttachedMeterResponse[];
  /** When true, the addon is required for this plan and cannot be deselected. */
  mandatory: boolean;
  /** Provider ids this addon supports; empty means all addon-capable providers. */
  compatibleProviders: string[];
}

export interface CreateAddonDto {
  key: string;
  name: string;
  description?: string;
  implementationType: AddonImplementationType;
  moduleKey?: string;
  scriptTemplate?: string;
  deprovisionScriptTemplate?: string;
  configSchema?: AddonConfigSchemaInput | Record<string, unknown>;
  defaultValues?: Record<string, string>;
  compatibleProviders?: string[];
  basePrice?: string;
  priceIntervalType?: BillingIntervalType;
  priceIntervalValue?: number;
  isActive?: boolean;
}

export interface UpdateAddonDto {
  name?: string;
  description?: string;
  implementationType?: AddonImplementationType;
  moduleKey?: string | null;
  scriptTemplate?: string | null;
  deprovisionScriptTemplate?: string | null;
  configSchema?: AddonConfigSchemaInput | Record<string, unknown>;
  defaultValues?: Record<string, string>;
  compatibleProviders?: string[];
  basePrice?: string | null;
  priceIntervalType?: BillingIntervalType | null;
  priceIntervalValue?: number | null;
  isActive?: boolean;
}

// Service Plans
export interface ServicePlanOrderingHighlight {
  icon: string;
  text: string;
}

export interface ServicePlanResponse {
  id: string;
  serviceTypeId: string | null;
  name: string;
  description?: string | null;
  billingIntervalType: BillingIntervalType;
  billingIntervalValue: number;
  billingDayOfMonth?: number | null;
  cancelAtPeriodEnd: boolean;
  /** When true, the period is billed at start (prepaid). */
  billInAdvance: boolean;
  /** When true, price may be recalculated nightly from the provider catalog. */
  autoRecalculatePriceDaily: boolean;
  minCommitmentDays: number;
  noticeDays: number;
  basePrice?: string | null;
  marginPercent?: string | null;
  marginFixed?: string | null;
  providerConfigDefaults: Record<string, unknown>;
  orderingHighlights: ServicePlanOrderingHighlight[];
  allowCustomerLocationSelection: boolean;
  allowCustomerServerTypeSelection: boolean;
  allowedServerTypes: string[];
  /** When true, customers may choose provider from allowedProviders at checkout. */
  allowCustomerProviderSelection: boolean;
  /** Provider ids customers may select when allowCustomerProviderSelection is true. */
  allowedProviders: string[];
  taxCategory?: TaxCategory;
  withdrawalPolicy: WithdrawalPolicy;
  isActive: boolean;
  meters?: AttachedMeterResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateServicePlanDto {
  /** UUID of a service type, or null for no deployment. */
  serviceTypeId?: string | null;
  name: string;
  description?: string;
  billingIntervalType: BillingIntervalType;
  billingIntervalValue: number;
  billingDayOfMonth?: number;
  cancelAtPeriodEnd?: boolean;
  billInAdvance?: boolean;
  autoRecalculatePriceDaily?: boolean;
  minCommitmentDays?: number;
  noticeDays?: number;
  basePrice?: string;
  marginPercent?: string;
  marginFixed?: string;
  providerConfigDefaults?: Record<string, unknown>;
  orderingHighlights?: ServicePlanOrderingHighlight[];
  allowCustomerLocationSelection?: boolean;
  allowCustomerServerTypeSelection?: boolean;
  allowedServerTypes?: string[];
  allowCustomerProviderSelection?: boolean;
  allowedProviders?: string[];
  taxCategory?: TaxCategory;
  isActive?: boolean;
}

export interface UpdateServicePlanDto {
  name?: string;
  description?: string;
  billingIntervalType?: BillingIntervalType;
  billingIntervalValue?: number;
  billingDayOfMonth?: number;
  cancelAtPeriodEnd?: boolean;
  billInAdvance?: boolean;
  autoRecalculatePriceDaily?: boolean;
  minCommitmentDays?: number;
  noticeDays?: number;
  basePrice?: string;
  marginPercent?: string;
  marginFixed?: string;
  providerConfigDefaults?: Record<string, unknown>;
  orderingHighlights?: ServicePlanOrderingHighlight[];
  allowCustomerLocationSelection?: boolean;
  allowCustomerServerTypeSelection?: boolean;
  allowedServerTypes?: string[];
  allowCustomerProviderSelection?: boolean;
  allowedProviders?: string[];
  taxCategory?: TaxCategory;
  /** Request-only: migrate eligible subscriptions when commercial pricing fields change. */
  migrateExistingSubscriptions?: boolean;
  isActive?: boolean;
}

// Subscriptions
export interface SubscriptionResponse {
  id: string;
  number: string;
  planId: string;
  /** Denormalized plan display name when provided by the API. */
  planName?: string;
  userId: string;
  status: SubscriptionStatus;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  nextBillingAt?: string | null;
  cancelRequestedAt?: string | null;
  cancelEffectiveAt?: string | null;
  resumedAt?: string | null;
  withdrawnAt?: string | null;
  instantRemoval?: boolean;
  instantCanceledAt?: string | null;
  withdrawalEligibility?: WithdrawalEligibility;
  withdrawalResult?: WithdrawalResult;
  periodTotalPrice?: number;
  meters?: SubscriptionMeterSummary[];
  items?: SubscriptionItemResponse[];
  createdAt: string;
  updatedAt: string;
}

/** SMTP configuration for cloud-init (email). */
export interface SmtpConfig {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  from?: string;
}

/** Keycloak configuration (when authenticationMethod is keycloak). */
export interface KeycloakConfig {
  serverUrl?: string;
  authServerUrl?: string;
  realm?: string;
  clientId?: string;
  clientSecret?: string;
}

/** Git configuration for manager instances (GIT_* env vars). */
export interface GitConfig {
  repositoryUrl?: string;
  username?: string;
  token?: string;
  password?: string;
  privateKey?: string;
  commitAuthorName?: string;
  commitAuthorEmail?: string;
}

/** Provisioned product service kind on a subscription item or cloud-init request. */
export type ProvisioningServiceKind = 'agenstra-controller' | 'agenstra-manager' | 'decabill-billing' | 'custom';

/** Cloud-init related part of requestedConfig (authentication, SMTP, optional provisioning tokens). */
export interface RequestedConfigCloudInit {
  /** Product service - controller, manager, or custom CloudInit template. */
  service?: ProvisioningServiceKind;
  authenticationMethod?: string;
  staticApiKey?: string;
  disableSignup?: boolean;
  smtp?: SmtpConfig;
  keycloak?: KeycloakConfig;
  /** Optional Hetzner API token for nested provisioning from the instance. */
  hetznerApiToken?: string;
  /** Optional DigitalOcean API token for nested provisioning from the instance. */
  digitaloceanApiToken?: string;
  /** Optional Git configuration for manager instances. */
  git?: GitConfig;
  /** Optional Cursor API key for manager instances (CURSOR_API_KEY env var). */
  cursorApiKey?: string;
}

export interface CreateSubscriptionDto {
  planId: string;
  addonIds?: string[];
  /** Per-addon order-form values, keyed by addon UUID then env key. */
  addonConfigs?: Record<string, Record<string, string>>;
  requestedConfig?: Record<string, unknown>;
  preferredAlternatives?: Record<string, unknown>;
  autoBackorder?: boolean;
  promotionCode?: string;
  promotionBenefitStartsAt?: string;
}

export interface CancelSubscriptionDto {
  reason?: string;
}

export interface WithdrawSubscriptionDto {
  reason?: string;
}

export interface ResumeSubscriptionDto {
  reason?: string;
}

// Subscription items and server info (overview / provisioned services)
export type ProvisioningStatus = 'pending' | 'active' | 'failed';

export interface SubscriptionItemResponse {
  id: string;
  subscriptionId: string;
  serviceTypeId: string | null;
  /** User-facing service type name from the catalog. */
  serviceTypeName?: string;
  /** Customer-defined label; null when unset. */
  displayName?: string | null;
  provisioningStatus: ProvisioningStatus;
  provisionedAt?: string | null;
  hostname?: string | null;
  /** Product service: agenstra-controller, agenstra-manager, decabill-billing, or custom CloudInit template. Defaults to agenstra-controller. */
  service?: ProvisioningServiceKind;
  /** True after the customer has revealed the provisioning SSH private key at least once. */
  sshAccessGranted?: boolean;
  /**
   * True when a live cloud provider reference exists.
   * The reference value itself is never returned by the API.
   */
  hasProviderReference?: boolean;
}

export type ServiceDetailTabSource = 'details' | 'addon' | 'integrated' | 'cloud-init';

export interface ServiceDetailTabDto {
  id: string;
  label: string;
  order: number;
  /** Contributor key (addon moduleKey, integrated service id, or CloudInit config key). */
  moduleKey: string | null;
  /** Contributor kind; optional for backward-compatible clients. */
  source?: ServiceDetailTabSource;
}

export interface ActiveSubscriptionAddonSummaryDto {
  id: string;
  addonId: string;
  key: string;
  name: string;
  moduleKey: string | null;
  status: string;
}

export interface ContainerManagerSummaryDto {
  containerCount: number;
  healthyCount: number;
  lastCollectedAt: string | null;
}

export interface SubscriptionItemDetailResponse extends SubscriptionItemResponse {
  serverInfo?: ServerInfoResponse;
  tabs: ServiceDetailTabDto[];
  activeAddons: ActiveSubscriptionAddonSummaryDto[];
  containerManager?: ContainerManagerSummaryDto;
}

export interface ContainerManagerResourceStats {
  cpuPercent: number | null;
  memoryUsageBytes: number | null;
  memoryLimitBytes: number | null;
  memoryPercent: number | null;
  blockReadBytes: number | null;
  blockWriteBytes: number | null;
  networkRxBytes: number | null;
  networkTxBytes: number | null;
}

export interface ContainerManagerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  createdAt: string | null;
  stats: ContainerManagerResourceStats | null;
}

export interface ContainerManagerContainersResponse {
  containers: ContainerManagerContainer[];
  collectedAt: string;
}

export interface ContainerManagerStatsHistoryPoint {
  timestamp: string;
  cpuPercent: number | null;
  memoryPercent: number | null;
  memoryUsageBytes: number | null;
  memoryLimitBytes: number | null;
  blockReadBytes: number | null;
  blockWriteBytes: number | null;
  networkRxBytes: number | null;
  networkTxBytes: number | null;
}

export interface ContainerManagerStatsHistoryResponse {
  containerId: string;
  points: ContainerManagerStatsHistoryPoint[];
}

export interface ContainerManagerLogsResponse {
  containerId: string;
  lines: string[];
  collectedAt: string;
  truncated: boolean;
  tail: number;
}

export type ContainerManagerNetworkNodeKind =
  | 'container'
  | 'network'
  | 'exit'
  | 'route'
  | 'host_iface'
  | 'host_gateway'
  | 'internet';

export interface ContainerManagerNetworkNode {
  id: string;
  label: string;
  kind: ContainerManagerNetworkNodeKind;
}

export interface ContainerManagerNetworkEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface ContainerManagerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
  isOverlay: boolean;
  containers: string[];
  exitNodes: string[];
  routes: Array<{ destination: string; gateway?: string }>;
}

export interface ContainerManagerHostInterface {
  name: string;
  state: string;
  addresses: string[];
}

export interface ContainerManagerHostRoute {
  destination: string;
  gateway?: string;
  device?: string;
}

export interface ContainerManagerNetworksResponse {
  networks: ContainerManagerNetwork[];
  topology: {
    nodes: ContainerManagerNetworkNode[];
    edges: ContainerManagerNetworkEdge[];
  };
  hostInterfaces: ContainerManagerHostInterface[];
  hostRoutes: ContainerManagerHostRoute[];
  collectedAt: string;
}

export interface SubscriptionSshAccessKeyResponse {
  privateKey: string;
}

export interface ServerInfoResponse {
  name: string;
  publicIp: string;
  privateIp?: string;
  status: string;
  metadata?: Record<string, unknown>;
  hostname?: string | null;
  hostnameFqdn?: string | null;
}

/** Payload of billing WebSocket `dashboardStatusUpdate` (aligned with REST server-info fields). */
export interface BillingDashboardStatusItem {
  subscriptionId: string;
  itemId: string;
  service: ProvisioningServiceKind;
  /** User-facing service type name from the catalog. */
  serviceTypeName?: string;
  /** Customer-defined label; null when unset. */
  displayName?: string | null;
  name: string;
  publicIp: string;
  privateIp?: string;
  status: string;
  metadata?: Record<string, unknown>;
  hostname?: string;
  hostnameFqdn?: string;
  sshAccessGranted?: boolean;
}

export interface BillingDashboardStatusUpdatePayload {
  generatedAt: string;
  items: BillingDashboardStatusItem[];
}

// Backorders
export interface BackorderResponse {
  id: string;
  userId: string;
  serviceTypeId: string;
  planId: string;
  /** Denormalized plan display name when provided by the API. */
  planName?: string;
  status: BackorderStatus;
  failureReason?: string | null;
  requestedConfigSnapshot: Record<string, unknown>;
  providerErrors: Record<string, unknown>;
  preferredAlternatives: Record<string, unknown>;
  retryAfter?: string | null;
  periodTotalPrice?: number;
  createdAt: string;
  updatedAt: string;
}

export interface BackorderRetryDto {
  reason?: string;
  overrideConfig?: Record<string, unknown>;
}

export interface BackorderCancelDto {
  reason?: string;
}

// Availability
export interface AvailabilityCheckDto {
  serviceTypeId: string;
  region: string;
  serverType: string;
  requestedConfig?: Record<string, unknown>;
}

export interface AvailabilityResponse {
  isAvailable: boolean;
  reason?: string;
  alternatives?: Record<string, unknown>;
}

// Pricing
export interface PricingPreviewDto {
  planId: string;
  addonIds?: string[];
  requestedConfig?: Record<string, unknown>;
}

export interface PricingPreviewAddonLine {
  addonId: string;
  name: string;
  periodPrice: number;
  /** When true, the addon is incompatible with the selected provider and excluded from totals. */
  invalid?: boolean;
}

export interface PricingPreviewResponse {
  basePrice: number;
  marginPercent: number;
  marginFixed: number;
  /** Net price per billing period (excl. VAT). */
  totalPrice: number;
  taxTotal: number;
  totalGross: number;
  taxRate: number;
  taxCategory?: TaxCategory;
  addonLines?: PricingPreviewAddonLine[];
  addonsTotal?: number;
  grandTotal?: number;
}

export interface TaxPreviewRates {
  standard: number;
  reduced: number;
}

export interface TaxPreviewLineItemDto {
  description?: string;
  quantity: number;
  unitPriceNet: number;
  taxCategory?: TaxCategory;
}

export interface TaxPreviewRequestDto {
  userId?: string;
  lineItems?: TaxPreviewLineItemDto[];
}

export interface TaxPreviewResponse {
  taxMode: string;
  taxCountryCode: string;
  chargeVat: boolean;
  taxNote: string | null;
  einvoiceTaxCategoryCode: string;
  rates: TaxPreviewRates;
  subtotalNet?: number;
  taxTotal?: number;
  totalGross?: number;
  lines?: Array<{
    description: string;
    quantity: number;
    unitPriceNet: number;
    taxCategory: TaxCategory;
    taxRate: number;
    lineNet: number;
    lineTax: number;
    lineGross: number;
  }>;
}

// Customer Profile
export type CustomerType = 'business' | 'consumer';

export type VatIdValidationStatus = 'none' | 'pending' | 'valid' | 'invalid' | 'unavailable';

export type VatIdValidationSource = 'vies_sync' | 'vies_async' | 'admin' | 'format_only';

export interface CustomerProfileResponse {
  id: string;
  userId: string;
  customerNumber: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  customerType?: CustomerType | null;
  vatId?: string | null;
  vatIdValidationStatus?: VatIdValidationStatus;
  vatIdValidatedAt?: string | null;
  vatIdValidationSource?: VatIdValidationSource | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  stripeCustomerId?: string | null;
  autoBillingEnabled?: boolean;
  hasPaymentMethodOnFile?: boolean;
  supportsAutoPayment?: boolean;
  pendingOffersCount?: number;
  actionRequiredOffersCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerProfileDto {
  firstName?: string;
  lastName?: string;
  company?: string;
  customerType?: CustomerType;
  vatId?: string | null;
  addressLine1?: string;
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  state?: string;
  country?: string;
  email?: string;
  phone?: string;
}

// Invoices
export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'partially_paid' | 'overdue' | 'void';

export type TaxCategory = 'standard' | 'reduced' | 'custom';

export interface InvoiceResponse {
  id: string;
  subscriptionId?: string;
  invoiceNumber?: string | null;
  status?: InvoiceStatus | string | null;
  balance?: number | null;
  totalGross?: number | null;
  subscriptionNumber?: string | null;
  createdAt: string;
  dueDate?: string | null;
  paidAt?: string | null;
  canPay: boolean;
  canDownload: boolean;
  canPreview: boolean;
  canDownloadVoidDocument?: boolean;
  canDownloadTimeReport?: boolean;
  voidDocumentNumber?: string | null;
  autoPaymentStatus?: string | null;
}

export interface InvoiceLineItemResponse {
  description: string;
  quantity: number;
  unitPriceNet: number;
  taxCategory: TaxCategory;
  taxRate: number;
  lineNet: number;
  lineTax: number;
  lineGross: number;
}

export interface InvoiceTaxBreakdown {
  taxCategory: TaxCategory;
  taxRate: number;
  taxAmount: number;
}

export interface InvoiceDetailResponse {
  id: string;
  subscriptionId?: string;
  invoiceNumber?: string | null;
  status: InvoiceStatus | string;
  currency: string;
  subtotalNet: number;
  taxTotal: number;
  totalGross: number;
  balanceDue: number;
  lineItems: InvoiceLineItemResponse[];
  taxBreakdown: InvoiceTaxBreakdown[];
  issuedAt?: string | null;
  dueDate?: string | null;
  paidAt?: string | null;
  createdAt: string;
  canPay: boolean;
  canDownload: boolean;
  canPreview: boolean;
  canDownloadVoidDocument?: boolean;
  canDownloadTimeReport?: boolean;
  voidDocumentNumber?: string | null;
}

export interface CreateInvoiceDto {
  description?: string;
}

export interface CreateInvoiceResponse {
  invoiceRefId: string;
  invoiceNumber?: string;
}

export interface InitiatePaymentResponse {
  checkoutUrl: string;
}

export interface InvoicesSummaryResponse {
  openOverdueCount: number;
  openOverdueTotal: number;
  /** Day of month (1-28) when the user is billed for open positions. */
  billingDayOfMonth: number;
  /** Total amount of unbilled open positions (to be invoiced on the next billing day). */
  unbilledTotal: number;
  /** Minimum balance due required for Checkout / payment-method charges. */
  minCheckoutPaymentAmount?: number;
  pendingOffersCount?: number;
}

/** Catalog counts for the current user (independent of list pagination / search). */
export interface SubscriptionsSummaryResponse {
  total: number;
  active: number;
  pendingBackorders: number;
}

// Usage
export interface UsageSummary {
  subscriptionId: string;
  periodStart: string;
  periodEnd: string;
  usagePayload: Record<string, unknown>;
}

export interface CreateUsageRecordDto {
  subscriptionId: string;
  periodStart: string;
  periodEnd: string;
  usagePayload?: Record<string, unknown>;
  meterId?: string;
  value?: number;
  attachmentType?: UsageAttachmentType;
  addonId?: string;
}

export interface UsageRecordResponse {
  id: string;
  subscriptionId: string;
  periodStart: string;
  periodEnd: string;
  usageSource: string;
  usagePayload: Record<string, unknown>;
  meterId?: string;
  value?: number;
  attachmentType?: UsageAttachmentType;
  addonId?: string | null;
  createdAt: string;
}

// Authentication
export interface LoginDto {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  user: UserResponse;
}

export interface RegisterDto {
  email: string;
  password: string;
}

export interface RegisterResponse {
  user: UserResponse;
  message: string;
}

export interface ConfirmEmailDto {
  email: string;
  code: string;
}

export interface RequestPasswordResetDto {
  email: string;
}

export interface ResetPasswordDto {
  email: string;
  code: string;
  newPassword: string;
}

export interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
  newPasswordConfirmation: string;
}

// Users
export interface UserResponse {
  id: string;
  email: string;
  role: UserRole;
  emailConfirmedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserDto {
  email: string;
  password: string;
  role?: UserRole;
}

export interface UpdateUserDto {
  email?: string;
  password?: string;
  role?: UserRole;
}

// Common
export interface ErrorResponse {
  statusCode: number;
  message: string;
  error: string;
}

export interface MessageResponse {
  message: string;
}

// Pagination
export interface ListParams {
  limit?: number;
  offset?: number;
  search?: string;
}

// Admin Billing
export interface AdminBillingSummaryResponse {
  subscriptionsCount: number;
  activeSubscriptionsCount: number;
  openOverdueCount: number;
  openOverdueTotal: number;
  unbilledTotal: number;
}

export interface AdminBillNowDto {
  userId?: string;
}

export interface AdminBillNowResponse {
  queued: boolean;
  requestId: string;
  userCount: number;
}

export interface AdminInvoiceListItem extends InvoiceResponse {
  userId: string;
  userEmail?: string;
}

export interface PaginatedAdminInvoicesResponse {
  items: AdminInvoiceListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminSubscriptionListItem extends SubscriptionResponse {
  userEmail?: string;
  planName?: string;
}

export interface AdminSubscriptionsListParams {
  limit?: number;
  offset?: number;
  search?: string;
  userId?: string;
}

export interface PaginatedAdminSubscriptionsResponse {
  items: AdminSubscriptionListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface MarkInvoicePaymentStatusDto {
  reason?: string;
  paidAt?: string;
}

export interface BillingAuditLogResponse {
  id: string;
  process: string;
  level: string;
  message: string;
  invoiceId?: string;
  userId?: string;
  context: Record<string, unknown>;
  createdAt: string;
}

export interface PaginatedBillingAuditLogsResponse {
  items: BillingAuditLogResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface BillingStatisticsSeriesPoint {
  period: string;
  totalGross: number;
}

export interface BillingStatisticsSummary {
  series: BillingStatisticsSeriesPoint[];
  totalGross: number;
  paidCount: number;
  from: string;
  to: string;
  groupBy: 'day' | 'month';
}

export interface BillingStatisticsByProductItem {
  planId: string;
  planName: string;
  totalGross: number;
}

export interface BillingStatisticsByProduct {
  items: BillingStatisticsByProductItem[];
  totalGross: number;
  from: string;
  to: string;
}

export interface BillingStatisticsByCountryItem {
  countryCode: string;
  countryName: string;
  totalGross: number;
}

export interface BillingStatisticsByCountry {
  items: BillingStatisticsByCountryItem[];
  totalGross: number;
  from: string;
  to: string;
}

export interface AdminBillingStatisticsParams {
  from?: string;
  to?: string;
  groupBy?: 'day' | 'month';
  userId?: string;
}

export interface AdminOpenOverdueListParams {
  limit?: number;
  offset?: number;
  search?: string;
  userId?: string;
}

export interface ManualInvoiceLineItemDto {
  description: string;
  quantity: number;
  unitPriceNet: number;
  taxCategory?: TaxCategory;
}

export interface CreateManualInvoiceDto {
  userId: string;
  subscriptionId?: string;
  lineItems: ManualInvoiceLineItemDto[];
  currency?: string;
}

export interface UpdateManualInvoiceDto {
  lineItems: ManualInvoiceLineItemDto[];
}

export interface IssueManualInvoiceDto {
  dueInDays?: number;
}

export interface ManualInvoiceDetailResponse extends InvoiceDetailResponse {
  userId: string;
  userEmail?: string;
}

export interface AdminCustomerProfileListItem {
  id: string;
  userId: string;
  customerNumber: string;
  userEmail?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  customerType?: CustomerType | null;
  vatId?: string | null;
  vatIdValidationStatus?: VatIdValidationStatus;
  vatIdValidatedAt?: string | null;
  vatIdValidationSource?: VatIdValidationSource | null;
  email?: string;
  country?: string;
  isComplete: boolean;
  stripeCustomerId?: string;
  trustScore?: number;
  trustLevel?: CustomerTrustLevel;
  trustScoreUpdatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedAdminCustomerProfilesResponse {
  items: AdminCustomerProfileListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateAdminCustomerProfileDto extends CustomerProfileDto {
  userId: string;
}

export interface AdminOfferProfileCounts {
  draft: number;
  archived: number;
  accepted: number;
  declined: number;
  expired: number;
  revoked: number;
}

export interface AdminCustomerProfileDetail extends CustomerProfileResponse {
  userEmail?: string;
  isComplete: boolean;
  numberScope: string;
  datevDebtorNumber?: number | null;
  trustScore?: number;
  trustLevel?: CustomerTrustLevel;
  trustScoreUpdatedAt?: string;
  offerCounts?: AdminOfferProfileCounts;
  /** Admin-only encrypted custom key/value map; never present on customer profile responses. */
  customData: Record<string, string>;
}

export interface AddCustomerProfileCustomDataDto {
  key: string;
  value: string;
}

export interface UpdateCustomerProfileCustomDataDto {
  value: string;
}

export type CustomerTrustLevel = 'green' | 'yellow' | 'red';

export interface CustomerTrustScoreFactor {
  id: string;
  label: string;
  description: string;
  points: number;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface CustomerTrustScoreDetail {
  profileId: string;
  userId: string;
  score: number;
  level: CustomerTrustLevel;
  baseScore: number;
  factors: CustomerTrustScoreFactor[];
  computedAt: string;
  sources: string[];
}

export type DatevExportScope = 'tenant' | 'unified';

export type DatevExportStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface BillingCapabilitiesResponse {
  datevExportEnabled: boolean;
  unifiedExportAllowed: boolean;
}

export interface AdminDatevExportListItem {
  id: string;
  scope: DatevExportScope;
  tenantId: string;
  periodYear: number;
  periodMonth: number;
  status: DatevExportStatus;
  fileName?: string;
  bookingCount: number;
  invoiceCount: number;
  debtorCount: number;
  includedTenantIds?: string[];
  errorMessage?: string;
  triggeredBy?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface QueuedDatevExport {
  clientId: string;
  scope: DatevExportScope;
  periodYear: number;
  periodMonth: number;
  queuedAt: string;
}

export interface AdminDatevExportQueuedListItem {
  kind: 'queued';
  id: string;
  scope: DatevExportScope;
  periodYear: number;
  periodMonth: number;
}

export type AdminDatevExportListEntry = AdminDatevExportListItem | AdminDatevExportQueuedListItem;

export function isQueuedDatevExportEntry(entry: AdminDatevExportListEntry): entry is AdminDatevExportQueuedListItem {
  return 'kind' in entry && entry.kind === 'queued';
}

export interface PaginatedAdminDatevExportsResponse {
  items: AdminDatevExportListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminDatevExportListParams {
  limit?: number;
  offset?: number;
  year?: number;
  scope?: DatevExportScope;
  search?: string;
}

export interface TriggerDatevExportDto {
  year: number;
  month: number;
  scope?: DatevExportScope;
  force?: boolean;
}

export interface TriggerDatevExportResponse {
  queued: boolean;
  scope: DatevExportScope;
  year: number;
  month: number;
}
