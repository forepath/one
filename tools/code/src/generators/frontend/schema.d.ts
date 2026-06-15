export interface FrontendGeneratorSchema {
  name: string;
  domain?: 'agenstra' | 'forepath' | 'shared';
  prefix?: string;
  ssr: boolean;
  ui: 'bootstrap' | 'none';
  protected: boolean;
  localization: boolean;
}
