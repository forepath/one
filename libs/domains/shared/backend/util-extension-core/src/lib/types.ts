import type { DynamicModule, Type } from '@nestjs/common';

export interface ForepathExtensionManifest {
  id: string;
  kind: string;
  name: string;
  description: string;
  version: string;
  entrypoint?: string;
  [key: string]: unknown;
}

export interface ForepathExtension<TContract = unknown> {
  register(): DynamicModule;
  getInstanceToken(): Type<TContract>;
}

export interface LoadedExtension<TContract = unknown> {
  manifest: ForepathExtensionManifest;
  extension: ForepathExtension<TContract>;
  packageRoot: string;
}

export type ExtensionSpecifier =
  | { type: 'monorepo'; importPath: string }
  | { type: 'npm'; packageName: string }
  | { type: 'file'; directory: string };
