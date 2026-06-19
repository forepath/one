import * as path from 'path';

import type { ExtensionSpecifier } from './types';

export function parseExtensionSpecifier(specifier: string, workspaceRoot: string): ExtensionSpecifier {
  const trimmed = specifier.trim();

  if (trimmed.startsWith('npm:')) {
    return { type: 'npm', packageName: trimmed.slice('npm:'.length).trim() };
  }

  if (trimmed.startsWith('file:')) {
    const directory = path.resolve(workspaceRoot, trimmed.slice('file:'.length).trim());

    return { type: 'file', directory };
  }

  if (trimmed.startsWith('@forepath/')) {
    return { type: 'monorepo', importPath: trimmed };
  }

  throw new Error(
    `Unsupported extension specifier '${specifier}'. Expected @forepath/..., npm:package, or file:relative/path.`,
  );
}
