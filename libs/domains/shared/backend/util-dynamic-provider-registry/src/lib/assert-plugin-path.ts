import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

export class PluginPathSecurityError extends Error {
  constructor(
    message: string,
    readonly candidatePath: string,
    readonly pluginRoot: string,
  ) {
    super(message);
    this.name = 'PluginPathSecurityError';
  }
}

/**
 * Resolves candidatePath and ensures it stays under pluginRoot (blocks traversal).
 */
export function resolvePathUnderPluginRoot(candidatePath: string, pluginRoot: string): string {
  const resolvedRoot = resolve(pluginRoot);
  const resolvedCandidate = candidatePath.startsWith('/')
    ? resolve(candidatePath)
    : resolve(resolvedRoot, candidatePath);

  if (!resolvedCandidate.startsWith(`${resolvedRoot}/`) && resolvedCandidate !== resolvedRoot) {
    throw new PluginPathSecurityError(
      `Path '${candidatePath}' resolves outside plugin root '${pluginRoot}'`,
      candidatePath,
      pluginRoot,
    );
  }

  try {
    return realpathSync(resolvedCandidate);
  } catch {
    return resolvedCandidate;
  }
}

export function assertPathUnderPluginRoot(candidatePath: string, pluginRoot: string): string {
  const resolved = resolvePathUnderPluginRoot(candidatePath, pluginRoot);
  const resolvedRoot = resolve(pluginRoot);

  try {
    const realCandidate = realpathSync(resolved);
    const realRoot = realpathSync(resolvedRoot);

    if (!realCandidate.startsWith(`${realRoot}/`) && realCandidate !== realRoot) {
      throw new PluginPathSecurityError(
        `Real path '${realCandidate}' escapes plugin root '${realRoot}'`,
        candidatePath,
        pluginRoot,
      );
    }

    return realCandidate;
  } catch (error) {
    if (error instanceof PluginPathSecurityError) {
      throw error;
    }

    return resolved;
  }
}
