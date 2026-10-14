import { BadRequestException } from '@nestjs/common';

/** Default agent workspace root inside worker containers. */
export const DEFAULT_AGENT_WORKSPACE_ROOT = '/app';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\x01-\x1f\x7f]/;

/**
 * System-scope roots trusted writers must never target: OS / runtime trees and the managed environment.
 * Root-installed layer files belong in agent-specific locations (e.g. `/opt/…`, `~/.config/opencode`).
 */
export const PROTECTED_SYSTEM_PATH_ROOTS = [
  '/bin',
  '/boot',
  '/dev',
  '/etc',
  '/lib',
  '/lib32',
  '/lib64',
  '/libx32',
  '/proc',
  '/root',
  '/run',
  '/sbin',
  '/sys',
  '/usr',
  '/var',
  '/opt/workspace',
] as const;

/** A path confined (lexically) to the agent workspace. */
export interface ResolvedWorkspaceFilePath {
  scope: 'workspace';
  /** Path relative to the workspace root (`''` for the root itself). */
  relativePath: string;
  /** Absolute container path (`<root>/<relativePath>`). */
  containerPath: string;
}

/** An absolute container path outside the agent workspace (trusted system writers only). */
export interface ResolvedSystemFilePath {
  scope: 'system';
  containerPath: string;
}

export interface WorkspaceFilePathOptions {
  /** Allow the workspace root itself (directory listings only). */
  allowRoot?: boolean;
}

interface PathSegments {
  absolute: boolean;
  segments: string[];
}

/**
 * Validate a raw path and split it into normalized segments.
 * Rejects non-strings, empty paths, null bytes and `..` segments; drops `.` and empty segments.
 */
function splitPathSegments(rawPath: unknown): PathSegments {
  if (typeof rawPath !== 'string') {
    throw new BadRequestException(`Path must be a string, got ${typeof rawPath}`);
  }

  const trimmed = rawPath.trim().replace(/\\/g, '/');

  if (!trimmed) {
    throw new BadRequestException('Path cannot be empty');
  }

  if (trimmed.includes('\0')) {
    throw new BadRequestException('Path cannot contain null bytes');
  }

  // Newlines and other control characters break shell-side path handling (e.g. `$(dirname …)` strips them).
  if (CONTROL_CHARACTERS.test(trimmed)) {
    throw new BadRequestException('Path cannot contain control characters');
  }

  const segments = trimmed.split('/').filter((segment) => segment.length > 0 && segment !== '.');

  if (segments.includes('..')) {
    throw new BadRequestException('Path traversal is not allowed');
  }

  return { absolute: trimmed.startsWith('/'), segments };
}

/** Normalize a provider workspace root to `/segment/...` (falls back to {@link DEFAULT_AGENT_WORKSPACE_ROOT}). */
export function normalizeWorkspaceRoot(workspaceRoot: string | undefined | null): string {
  const raw = workspaceRoot?.trim().replace(/\\/g, '/') ?? '';

  if (!raw.startsWith('/')) {
    return DEFAULT_AGENT_WORKSPACE_ROOT;
  }

  const segments = raw.split('/').filter((segment) => segment.length > 0 && segment !== '.');

  if (segments.length === 0 || segments.includes('..')) {
    return DEFAULT_AGENT_WORKSPACE_ROOT;
  }

  return `/${segments.join('/')}`;
}

/** Strip the workspace root prefix from absolute segments, or `null` when outside the workspace. */
function relativeSegmentsWithinRoot(segments: string[], workspaceRoot: string): string[] | null {
  const rootSegments = workspaceRoot.split('/').filter(Boolean);

  if (segments.length < rootSegments.length) {
    return null;
  }

  for (let i = 0; i < rootSegments.length; i += 1) {
    if (segments[i] !== rootSegments[i]) {
      return null;
    }
  }

  return segments.slice(rootSegments.length);
}

function toWorkspacePath(
  relativeSegments: string[],
  workspaceRoot: string,
  options: WorkspaceFilePathOptions,
): ResolvedWorkspaceFilePath {
  const relativePath = relativeSegments.join('/');

  if (!relativePath && !options.allowRoot) {
    throw new BadRequestException('Path must not target the workspace root');
  }

  return {
    scope: 'workspace',
    relativePath,
    containerPath: relativePath ? `${workspaceRoot}/${relativePath}` : workspaceRoot,
  };
}

/**
 * Resolve a user-supplied file path into the agent workspace (lexical containment).
 * Relative paths (incl. `./…`) are joined under the workspace root; absolute paths are accepted only
 * when they already point inside the workspace root (e.g. `/app/src/a.ts`, as sent by ACP agents).
 * Symlinks are not resolved here — callers must additionally verify the canonical target in the container.
 * @throws BadRequestException for invalid paths or paths outside the workspace
 */
export function resolveWorkspaceFilePath(
  rawPath: unknown,
  workspaceRoot: string,
  options: WorkspaceFilePathOptions = {},
): ResolvedWorkspaceFilePath {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const { absolute, segments } = splitPathSegments(rawPath);

  if (!absolute) {
    return toWorkspacePath(segments, root, options);
  }

  const relativeSegments = relativeSegmentsWithinRoot(segments, root);

  if (!relativeSegments) {
    throw new BadRequestException('Path must stay within the agent workspace');
  }

  return toWorkspacePath(relativeSegments, root, options);
}

/**
 * Resolve a path for trusted system writers (OpenCode layer files, context attachments).
 * Relative paths and absolute paths inside the workspace resolve to the workspace scope;
 * other absolute paths resolve to the system scope (never the filesystem root).
 * @throws BadRequestException for invalid paths
 */
export function resolveSystemFilePath(
  rawPath: unknown,
  workspaceRoot: string,
  options: WorkspaceFilePathOptions = {},
): ResolvedWorkspaceFilePath | ResolvedSystemFilePath {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const { absolute, segments } = splitPathSegments(rawPath);

  if (!absolute) {
    return toWorkspacePath(segments, root, options);
  }

  const relativeSegments = relativeSegmentsWithinRoot(segments, root);

  if (relativeSegments) {
    return toWorkspacePath(relativeSegments, root, options);
  }

  if (segments.length === 0) {
    throw new BadRequestException('Path must not target the filesystem root');
  }

  const containerPath = `/${segments.join('/')}`;

  if (PROTECTED_SYSTEM_PATH_ROOTS.some((root) => containerPath === root || containerPath.startsWith(`${root}/`))) {
    throw new BadRequestException('System file paths must not target protected system directories');
  }

  return { scope: 'system', containerPath };
}
