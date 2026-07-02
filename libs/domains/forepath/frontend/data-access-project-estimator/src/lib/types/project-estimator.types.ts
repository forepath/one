export type ForepathServiceId =
  | 'consulting'
  | 'it-systems'
  | 'software-development'
  | 'travel-km'
  | 'travel-short'
  | 'travel-long';

export type ForepathRateTier = 'standard' | 'emergency-week' | 'emergency-sunday';

export type DeviceCapabilityStatus = 'pending' | 'checking' | 'supported' | 'unsupported';

export type GpuAccessStatus = 'not-applicable' | 'pending' | 'requesting' | 'granted' | 'denied';

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ProjectBreakdownLineItem {
  serviceId: ForepathServiceId;
  description: string;
  billingUnits?: number;
  quantity?: number;
  rateTier?: ForepathRateTier;
}

export interface ProjectBreakdown {
  summary: string;
  lineItems: ProjectBreakdownLineItem[];
  assumptions: string[];
  confidence: 'low' | 'medium' | 'high';
}

export interface ProjectEstimateLineItem {
  serviceId: ForepathServiceId;
  serviceName: string;
  description: string;
  billingUnits?: number;
  quantity?: number;
  rateTier?: ForepathRateTier;
  unitLabel: string;
  unitPrice: number;
  lineTotal: number;
}

export interface ProjectEstimate {
  summary: string;
  lineItems: ProjectEstimateLineItem[];
  subtotalNet: number;
  assumptions: string[];
  confidence: 'low' | 'medium' | 'high';
  disclaimer: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  estimate?: ProjectEstimate;
}

export interface ForepathServiceCatalogEntry {
  id: ForepathServiceId;
  name: string;
  description: string;
  unitLabel: string;
  supportsRateTier: boolean;
  rates: Partial<Record<ForepathRateTier, number>> & { standard: number };
}
