/**
 * Subscription item in API responses. Provider reference is internal only and never exposed.
 */
export interface SubscriptionItemResponseDto {
  id: string;
  subscriptionId: string;
  serviceTypeId: string;
  provisioningStatus: 'pending' | 'active' | 'failed';
  /** Single-level subdomain when provisioned (e.g. awesome-armadillo-abc12) */
  hostname?: string;
  /** Product service from config snapshot: controller (full stack) or manager (agent manager only). Defaults to controller. */
  service?: 'controller' | 'manager';
}
