export interface ProviderGeneratorSchema {
  domain: 'agenstra' | 'decabill';
  name: string;
  kind: string;
  description?: string;
  version?: string;
  generator?: 'js' | 'node';
}
