import type { ServiceDetailTabComponent } from '../contributors/contributor-ui.types';
import { collectContributorTabComponents } from '../contributors/contributor-ui.registry';
import { FIRST_PARTY_CONTRIBUTOR_UI_MODULES } from '../contributors/first-party-contributor-ui.modules';

export type { ServiceDetailTabComponent } from '../contributors/contributor-ui.types';

/** @deprecated Prefer ServiceDetailTabComponent */
export type ServiceDetailAddonTabComponent = ServiceDetailTabComponent;

/**
 * Frontend registry: tab id -> component.
 * Merged from compile-time first-party contributor UI modules.
 */
export const SERVICE_DETAIL_TAB_REGISTRY: Record<string, ServiceDetailTabComponent> = collectContributorTabComponents(
  FIRST_PARTY_CONTRIBUTOR_UI_MODULES,
);

/** @deprecated Prefer SERVICE_DETAIL_TAB_REGISTRY */
export const SERVICE_DETAIL_ADDON_TAB_REGISTRY = SERVICE_DETAIL_TAB_REGISTRY;

export function resolveServiceDetailTabComponent(tabId: string): ServiceDetailTabComponent | null {
  return SERVICE_DETAIL_TAB_REGISTRY[tabId] ?? null;
}

/** @deprecated Prefer resolveServiceDetailTabComponent */
export function resolveServiceDetailAddonTabComponent(tabId: string): ServiceDetailTabComponent | null {
  return resolveServiceDetailTabComponent(tabId);
}
