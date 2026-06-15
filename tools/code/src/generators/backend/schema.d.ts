export interface BackendGeneratorSchema {
  name: string;
  domain?: 'agenstra' | 'forepath' | 'shared';
  protected: boolean;
}
