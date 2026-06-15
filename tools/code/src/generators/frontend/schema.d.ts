export interface FrontendGeneratorSchema {
  name: string;
  domain?: string;
  prefix?: string;
  ssr: boolean;
  ui: 'bootstrap' | 'none';
  protected: boolean;
  localization: boolean;
}
