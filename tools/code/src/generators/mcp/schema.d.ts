export interface McpGeneratorSchema {
  name: string;
  domain?: 'agenstra' | 'forepath' | 'shared';
  protected: boolean;
}
