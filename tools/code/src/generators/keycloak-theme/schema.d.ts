export interface KeycloakThemeGeneratorSchema {
  name: string;
  domain?: 'agenstra' | 'forepath' | 'shared';
  prefix?: string;
}
