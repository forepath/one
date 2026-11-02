import type { ServerInfoResponseDto } from './server-info-response.dto';

/**
 * Subscription item in API responses. Provider reference is internal only and never exposed.
 */
export interface SubscriptionItemResponseDto {
  id: string;
  subscriptionId: string;
  serviceTypeId: string | null;
  /** User-facing service type name from the catalog (billing_service_types.name). */
  serviceTypeName: string;
  provisioningStatus: 'pending' | 'active' | 'failed';
  /** Single-level subdomain when provisioned (e.g. awesome-armadillo-abc12) */
  hostname?: string;
  /** Customer-defined label; null when unset. */
  displayName: string | null;
  /** Product service from config snapshot: agenstra-controller, agenstra-manager, decabill-billing, loadweaver, or custom CloudInit template. Defaults to agenstra-controller. */
  service?: 'agenstra-controller' | 'agenstra-manager' | 'decabill-billing' | 'loadweaver' | 'custom';
  /** True after the customer has revealed the provisioning SSH private key at least once. */
  sshAccessGranted: boolean;
  /**
   * Whether a live cloud provider reference exists for this item.
   * The reference value itself is never exposed.
   */
  hasProviderReference: boolean;
}

/** Who contributed a service-detail tab. */
export type ServiceDetailTabSource = 'details' | 'addon' | 'integrated' | 'cloud-init';

/** Built-in Details tab plus contributor-registered tabs for the service details page. */
export interface ServiceDetailTabDto {
  id: string;
  label: string;
  order: number;
  /**
   * Contributor key: addon moduleKey, integrated service id, or CloudInit config key;
   * null for the built-in Details tab.
   */
  moduleKey: string | null;
  /** Contributor kind that registered the tab. */
  source: ServiceDetailTabSource;
}

export interface ActiveSubscriptionAddonSummaryDto {
  id: string;
  addonId: string;
  key: string;
  name: string;
  moduleKey: string | null;
  status: string;
}

/** Lightweight Container Manager summary embedded on the item detail profile when the addon is active. */
export interface ContainerManagerSummaryDto {
  containerCount: number;
  healthyCount: number;
  lastCollectedAt: string | null;
}

/** Detail view for an active provisioned subscription item, including cached or live server info. */
export interface SubscriptionItemDetailResponseDto extends SubscriptionItemResponseDto {
  serverInfo?: ServerInfoResponseDto;
  /**
   * Always includes the Details tab; additional tabs come from active module addons,
   * the item's integrated stack, and/or the active CloudInit config.
   */
  tabs: ServiceDetailTabDto[];
  /** Active (and pending) subscription addons relevant to the UI. */
  activeAddons: ActiveSubscriptionAddonSummaryDto[];
  /** Present when Container Manager is active on the subscription. */
  containerManager?: ContainerManagerSummaryDto;
}

/** One-time SSH private key response. Never log this payload. */
export interface SubscriptionSshAccessKeyResponseDto {
  privateKey: string;
}
