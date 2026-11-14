import type { Type } from '@nestjs/common';
import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { CONTRIBUTOR_JOB_KEY_PATTERN, type ContributorJobSource } from './contributor-job.types';

export type ContributorNestSource = ContributorJobSource;

export interface RegisteredContributorNestModule {
  source: ContributorNestSource;
  sourceKey: string;
  nestModule: Type<unknown>;
}

const ITEM_PATH_PREFIX = 'subscriptions/:subscriptionId/items/:itemId';
const ADMIN_PREFIX = 'admin/billing';
const STANDALONE_PREFIX = 'contributor';

export function normalizeContributorControllerPath(path: string): string {
  return path
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/');
}

export function allowedContributorControllerPaths(source: ContributorNestSource, sourceKey: string): string[] {
  const key = sourceKey.trim();
  const itemPath = `${ITEM_PATH_PREFIX}/${key}`;
  const standalonePath = `${STANDALONE_PREFIX}/${source}/${key}`;

  return [itemPath, `${ADMIN_PREFIX}/${itemPath}`, standalonePath, `${ADMIN_PREFIX}/${standalonePath}`];
}

export function isAllowedContributorControllerPath(
  path: string,
  source: ContributorNestSource,
  sourceKey: string,
): boolean {
  const normalized = normalizeContributorControllerPath(path);

  if (!normalized) {
    return false;
  }

  return allowedContributorControllerPaths(source, sourceKey).includes(normalized);
}

export function sanitizeContributorSourceKey(sourceKey: string): string {
  const key = sourceKey?.trim() ?? '';

  if (!CONTRIBUTOR_JOB_KEY_PATTERN.test(key)) {
    throw new Error('Invalid contributor source key');
  }

  return key;
}

export function resolveContributorKeyFromPackage(
  moduleExports: Record<string, unknown>,
  alias?: string,
): string | undefined {
  const exported = moduleExports['contributorKey'];

  if (typeof exported === 'string' && exported.trim()) {
    return sanitizeContributorSourceKey(exported);
  }

  if (alias?.trim()) {
    return sanitizeContributorSourceKey(alias);
  }

  return undefined;
}

export function resolveNestModuleExport(moduleExports: Record<string, unknown>): Type<unknown> | undefined {
  const nestModule = moduleExports['nestModule'];

  if (nestModule === undefined) {
    return undefined;
  }

  if (typeof nestModule !== 'function') {
    throw new Error('Invalid nestModule export');
  }

  return nestModule as Type<unknown>;
}

export function listNestModuleControllers(nestModule: Type<unknown>): Type<unknown>[] {
  const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, nestModule) as unknown;

  if (!Array.isArray(controllers)) {
    return [];
  }

  return controllers.filter((controller): controller is Type<unknown> => typeof controller === 'function');
}

export function readControllerPaths(controller: Type<unknown>): string[] {
  const raw = Reflect.getMetadata(PATH_METADATA, controller) as unknown;

  if (raw == null || raw === '') {
    return [''];
  }

  if (Array.isArray(raw)) {
    return raw.map((entry) => String(entry));
  }

  return [String(raw)];
}

export function validateContributorNestModule(registration: RegisteredContributorNestModule): void {
  const sourceKey = sanitizeContributorSourceKey(registration.sourceKey);

  if (typeof registration.nestModule !== 'function') {
    throw new Error('Invalid nestModule export');
  }

  const controllers = listNestModuleControllers(registration.nestModule);

  for (const controller of controllers) {
    for (const path of readControllerPaths(controller)) {
      if (!isAllowedContributorControllerPath(path, registration.source, sourceKey)) {
        throw new Error('Contributor controller path is not allowed');
      }
    }
  }
}

export function registerContributorNestModules(registrations: RegisteredContributorNestModule[]): Type<unknown>[] {
  const byIdentity = new Set<string>();
  const byPath = new Set<string>();
  const modules: Type<unknown>[] = [];

  for (const registration of registrations) {
    const sourceKey = sanitizeContributorSourceKey(registration.sourceKey);
    const identity = `${registration.source}:${sourceKey}`;

    if (byIdentity.has(identity)) {
      throw new Error('Duplicate contributor nestModule registration');
    }

    validateContributorNestModule({ ...registration, sourceKey });

    for (const controller of listNestModuleControllers(registration.nestModule)) {
      for (const path of readControllerPaths(controller)) {
        const normalized = normalizeContributorControllerPath(path);

        if (byPath.has(normalized)) {
          throw new Error('Duplicate contributor controller path');
        }

        byPath.add(normalized);
      }
    }

    byIdentity.add(identity);
    modules.push(registration.nestModule);
  }

  return modules;
}
