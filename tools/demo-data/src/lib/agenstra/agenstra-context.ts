import { ColumnEncryptor } from '../core/encryption';
import { PasswordHasher } from '../core/passwords';
import { DemoRandom } from '../core/random';

export interface DemoAgent {
  id: string;
  name: string;
  /** Plaintext login password (hashed in the manager DB, encrypted in the controller DB). */
  password: string;
  containerType: string;
  /** Workspace the agent is attributed to in statistics. */
  homeWorkspaceKey: string;
  chatSessionIds: string[];
  createdAt: Date;
}

export interface DemoWorkspaceSpec {
  key: string;
  name: string;
  description: string;
  topic: string;
  /** Workspaces that point to the locally started agent-manager. */
  reachable: boolean;
}

export const DEMO_WORKSPACES: readonly DemoWorkspaceSpec[] = [
  {
    key: 'webshop',
    name: 'Webshop Relaunch',
    description: 'Headless storefront, checkout and CMS integration.',
    topic: 'e-commerce',
    reachable: true,
  },
  {
    key: 'mobile',
    name: 'Mobile Banking App',
    description: 'React Native app with biometric login and push notifications.',
    topic: 'mobile',
    reachable: true,
  },
  {
    key: 'data',
    name: 'Data Platform',
    description: 'Ingestion pipelines, dbt models and the analytics warehouse.',
    topic: 'data',
    reachable: true,
  },
  {
    key: 'infra',
    name: 'Infrastructure as Code (remote)',
    description: 'Terraform modules on a remote agent-manager that is currently unreachable.',
    topic: 'infrastructure',
    reachable: false,
  },
];

export const DEMO_AGENT_SPECS = [
  { name: 'webshop-frontend', workspace: 'webshop', containerType: 'generic', repo: 'webshop/storefront' },
  { name: 'webshop-checkout', workspace: 'webshop', containerType: 'docker', repo: 'webshop/checkout-service' },
  { name: 'mobile-app', workspace: 'mobile', containerType: 'generic', repo: 'mobile/banking-app' },
  { name: 'mobile-api', workspace: 'mobile', containerType: 'docker', repo: 'mobile/backend-for-frontend' },
  { name: 'data-pipelines', workspace: 'data', containerType: 'kubernetes', repo: 'data/pipelines' },
  { name: 'infra-terraform', workspace: 'data', containerType: 'terraform', repo: 'platform/terraform-modules' },
] as const;

export const DEMO_CHAT_MODELS = [
  'anthropic/claude-sonnet-4-5',
  'openai/gpt-5',
  'google/gemini-2.5-pro',
  'ollama/qwen3-coder',
] as const;

export interface AgenstraSeedContext {
  random: DemoRandom;
  hasher: PasswordHasher;
  controllerEncryptor: ColumnEncryptor;
  managerEncryptor: ColumnEncryptor;
}
