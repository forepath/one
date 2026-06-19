import * as path from 'path';

import { formatFiles, generateFiles, names, Tree } from '@nx/devkit';

import { libGenerator } from '../lib/lib';
import { ProviderGeneratorSchema } from './schema';

const CONTRACT_BY_KIND: Record<string, string> = {
  'agent-provider': 'AgentProvider',
  'pipeline-provider': 'PipelineProvider',
  'chat-filter': 'ChatFilter',
  'provisioning-provider': 'ProvisioningProvider',
  'external-import-provider': 'ExternalContextImportProvider',
  'embedding-provider': 'EmbeddingProvider',
  'payment-processor': 'PaymentProcessor',
  'billing-provisioning-provider': 'BillingProvisioningProvider',
};

function toDisplayName(providerName: string): string {
  return providerName
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export async function providerGenerator(tree: Tree, options: ProviderGeneratorSchema) {
  const contractName = CONTRACT_BY_KIND[options.kind];

  if (!contractName) {
    throw new Error(
      `Unknown extension kind '${options.kind}'. Expected one of: ${Object.keys(CONTRACT_BY_KIND).join(', ')}`,
    );
  }

  const normalized = names(options.name);
  const version = options.version ?? '0.0.0';
  const description =
    options.description ?? `${toDisplayName(options.name)} ${options.kind.replace(/-/g, ' ')} extension.`;
  const libImportRoot = `provider-${options.name}`;
  const importPath = `@forepath/${options.domain}/backend/${libImportRoot}`;
  const libRoot = `libs/domains/${options.domain}/backend/${libImportRoot}`;
  const schemaRef = '../../../shared/backend/util-extension-core/src/schemas/forepath.extension.schema.json';

  await libGenerator(tree, {
    domain: options.domain,
    scope: 'backend',
    type: 'provider',
    name: options.name,
    generator: options.generator ?? 'node',
  });

  const nxStubBase = `${options.domain}-backend-provider-${options.name}`;
  tree.delete(`${libRoot}/src/lib/${nxStubBase}.ts`);
  tree.delete(`${libRoot}/src/lib/${nxStubBase}.spec.ts`);

  generateFiles(tree, path.join(__dirname, 'files'), libRoot, {
    ...options,
    ...normalized,
    contractName,
    description,
    version,
    importPath,
    schemaRef,
    extensionFactoryName: `create${normalized.className}Extension`,
  });

  await formatFiles(tree);
}

export default providerGenerator;
