/**
 * Integrated product stacks offered as plan provisioning options.
 * String values are persisted in plan defaults and subscription item snapshots.
 */
export enum IntegratedProvisioningService {
  AgenstraController = 'agenstra-controller',
  AgenstraManager = 'agenstra-manager',
  DecabillBilling = 'decabill-billing',
  Loadweaver = 'loadweaver',
}

/**
 * Cloud-init dispatch target: integrated stacks plus admin-defined custom templates.
 */
export enum CloudInitServiceType {
  AgenstraController = IntegratedProvisioningService.AgenstraController,
  AgenstraManager = IntegratedProvisioningService.AgenstraManager,
  DecabillBilling = IntegratedProvisioningService.DecabillBilling,
  Loadweaver = IntegratedProvisioningService.Loadweaver,
  Custom = 'custom',
}

const INTEGRATED_SERVICE_VALUES = new Set<string>(Object.values(IntegratedProvisioningService));

/** Legacy ids accepted only when reading/parsing pre-rename data or clients. */
const LEGACY_INTEGRATED_SERVICE_ALIASES: Record<string, IntegratedProvisioningService> = {
  controller: IntegratedProvisioningService.AgenstraController,
  manager: IntegratedProvisioningService.AgenstraManager,
};

const LEGACY_TO_CANONICAL: Record<string, string> = {
  controller: IntegratedProvisioningService.AgenstraController,
  manager: IntegratedProvisioningService.AgenstraManager,
};

const CANONICAL_TO_LEGACY: Record<string, string> = {
  [IntegratedProvisioningService.AgenstraController]: 'controller',
  [IntegratedProvisioningService.AgenstraManager]: 'manager',
};

export function isIntegratedProvisioningService(value: string): value is IntegratedProvisioningService {
  return INTEGRATED_SERVICE_VALUES.has(value);
}

/**
 * Maps a stored or requested service id to a canonical integrated service, including legacy aliases.
 */
export function canonicalizeIntegratedProvisioningService(value: string): IntegratedProvisioningService | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  if (isIntegratedProvisioningService(trimmed)) {
    return trimmed;
  }

  return LEGACY_INTEGRATED_SERVICE_ALIASES[trimmed] ?? null;
}

/**
 * Maps a stored or requested cloud-init service id (integrated, custom, or legacy) to the enum.
 * Unknown values default to agenstra-controller for backward compatibility.
 */
export function canonicalizeCloudInitService(value: string | undefined): CloudInitServiceType {
  if (value === CloudInitServiceType.Custom || value === 'custom') {
    return CloudInitServiceType.Custom;
  }

  const integrated = value ? canonicalizeIntegratedProvisioningService(value) : null;

  if (integrated === IntegratedProvisioningService.AgenstraManager) {
    return CloudInitServiceType.AgenstraManager;
  }

  if (integrated === IntegratedProvisioningService.DecabillBilling) {
    return CloudInitServiceType.DecabillBilling;
  }

  if (integrated === IntegratedProvisioningService.Loadweaver) {
    return CloudInitServiceType.Loadweaver;
  }

  return CloudInitServiceType.AgenstraController;
}

export function allIntegratedProvisioningServices(): IntegratedProvisioningService[] {
  return Object.values(IntegratedProvisioningService);
}

export function integratedProvisioningServiceLabel(service: IntegratedProvisioningService): string {
  switch (service) {
    case IntegratedProvisioningService.AgenstraManager:
      return 'Agenstra Manager';
    case IntegratedProvisioningService.DecabillBilling:
      return 'Decabill Billing';
    case IntegratedProvisioningService.Loadweaver:
      return 'Loadweaver';
    default:
      return 'Agenstra Controller';
  }
}

export function integratedProvisioningServiceDescription(service: IntegratedProvisioningService): string {
  switch (service) {
    case IntegratedProvisioningService.AgenstraManager:
      return 'Runs the agent manager only.';
    case IntegratedProvisioningService.DecabillBilling:
      return 'Runs the Decabill billing manager and console stack.';
    case IntegratedProvisioningService.Loadweaver:
      return 'Runs a single-node Loadweaver cluster (control plane, console, node agent).';
    default:
      return 'Runs the full agent controller stack.';
  }
}

function rewriteServiceId(value: unknown, map: Record<string, string>): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return map[value];
}

function rewriteProvisioningOptionKey(value: unknown, map: Record<string, string>): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('integrated:')) {
    return undefined;
  }

  const rawService = value.slice('integrated:'.length);
  const rewritten = map[rawService];

  return rewritten ? `integrated:${rewritten}` : undefined;
}

/**
 * Rewrites legacy or canonical integrated service ids inside a config/defaults object.
 * Used by the data migration (and reversible down path).
 */
export function rewriteIntegratedServiceIdsInConfig(
  config: Record<string, unknown>,
  direction: 'toCanonical' | 'toLegacy',
): { changed: boolean; config: Record<string, unknown> } {
  const map = direction === 'toCanonical' ? LEGACY_TO_CANONICAL : CANONICAL_TO_LEGACY;
  let changed = false;
  const next: Record<string, unknown> = { ...config };

  const rewrittenService = rewriteServiceId(next['service'], map);

  if (rewrittenService) {
    next['service'] = rewrittenService;
    changed = true;
  }

  const rewrittenKey = rewriteProvisioningOptionKey(next['provisioningOptionKey'], map);

  if (rewrittenKey) {
    next['provisioningOptionKey'] = rewrittenKey;
    changed = true;
  }

  const rawOptions = next['provisioningOptions'];

  if (Array.isArray(rawOptions)) {
    let optionsChanged = false;
    const rewrittenOptions = rawOptions.map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return entry;
      }

      const option = entry as Record<string, unknown>;

      if (option['type'] !== 'integrated') {
        return entry;
      }

      const rewritten = rewriteServiceId(option['service'], map);

      if (!rewritten) {
        return entry;
      }

      optionsChanged = true;

      return { ...option, service: rewritten };
    });

    if (optionsChanged) {
      next['provisioningOptions'] = rewrittenOptions;
      changed = true;
    }
  }

  return { changed, config: next };
}
