import type { ForepathServiceCatalogEntry, ForepathServiceId } from '../types/project-estimator.types';

export const FOREPATH_BILLING_UNIT_MINUTES = 15;

export const FOREPATH_SERVICE_IDS: readonly ForepathServiceId[] = [
  'consulting',
  'it-systems',
  'software-development',
  'travel-km',
  'travel-short',
  'travel-long',
] as const;

export const FOREPATH_SERVICE_CATALOG: readonly ForepathServiceCatalogEntry[] = [
  {
    id: 'consulting',
    name: 'Consulting',
    description:
      'Strategy, architecture, and delivery guidance alongside your team. Estimated using the software development standard rate.',
    unitLabel: '15-minute billing unit',
    supportsRateTier: false,
    rates: { standard: 33.76 },
  },
  {
    id: 'it-systems',
    name: 'IT Systems',
    description: 'Managed IT operations, platform support, and infrastructure work.',
    unitLabel: '15-minute billing unit',
    supportsRateTier: true,
    rates: {
      standard: 30.54,
      'emergency-week': 45.81,
      'emergency-sunday': 61.08,
    },
  },
  {
    id: 'software-development',
    name: 'Software Development',
    description: 'Design, build, and maintain custom software in production.',
    unitLabel: '15-minute billing unit',
    supportsRateTier: false,
    rates: { standard: 33.76 },
  },
  {
    id: 'travel-km',
    name: 'Car mileage',
    description: 'Per kilometer started, plus applicable travel time.',
    unitLabel: 'kilometer',
    supportsRateTier: false,
    rates: { standard: 0.75 },
  },
  {
    id: 'travel-short',
    name: 'Short-distance travel',
    description: 'Flat rate for travel within the Herford district.',
    unitLabel: 'flat rate',
    supportsRateTier: false,
    rates: { standard: 48.23 },
  },
  {
    id: 'travel-long',
    name: 'Long-distance travel time',
    description: 'Travel outside the Herford district, per hour started.',
    unitLabel: 'hour',
    supportsRateTier: false,
    rates: { standard: 64.3 },
  },
] as const;

export const FOREPATH_ESTIMATE_DISCLAIMER =
  'Indicative estimate only, excluding statutory VAT. Final pricing depends on scope confirmation.';

export const FOREPATH_LOCAL_LLM_MODEL_ID = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';

export { FOREPATH_LOCAL_LLM_MODEL_ID_STANDARD } from './forepath-llm-memory.constants';

export const FOREPATH_LOCAL_LLM_MODEL_BASE_URL = '/assets/models/qwen2.5-1.5b-instruct/';

export { FOREPATH_MIN_DEVICE_MEMORY_GB, FOREPATH_MIN_HARDWARE_CONCURRENCY } from './forepath-llm-memory.constants';

export function getServiceCatalogEntry(serviceId: ForepathServiceId): ForepathServiceCatalogEntry | undefined {
  return FOREPATH_SERVICE_CATALOG.find((entry) => entry.id === serviceId);
}

export function getServiceDisplayName(serviceId: ForepathServiceId): string {
  return getServiceCatalogEntry(serviceId)?.name ?? serviceId;
}
