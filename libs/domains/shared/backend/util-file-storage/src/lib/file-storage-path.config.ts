import * as path from 'path';

import {
  FILE_STORAGE_PREVIOUS_SCOPE_SEGMENTS,
  FILE_STORAGE_SCOPE_SEGMENTS,
  type FileStorageScope,
  FileStorageScope as Scopes,
} from './file-storage-scope.constants';
import { FILE_STORAGE_DEFAULT_PROVIDER } from './file-storage.constants';

/**
 * Canonical storage base.
 * Prefer `FILE_STORAGE_ROOT` (compose sets `/data`). When unset, use `{cwd}/data`
 * so local Nest/Nx matches historical Decabill layout.
 */
export function readFileStorageRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.FILE_STORAGE_ROOT?.trim();

  if (configured) {
    return configured;
  }

  return path.join(process.cwd(), 'data');
}

/**
 * Runtime I/O root for a scope: `{FILE_STORAGE_ROOT}/{segment}`.
 */
export function resolveCanonicalScopeRoot(scope: FileStorageScope, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(readFileStorageRoot(env), FILE_STORAGE_SCOPE_SEGMENTS[scope]);
}

/** Absolute path for a previous (pre-split) segment under the storage root. */
export function resolvePreviousSegmentRoot(segment: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(readFileStorageRoot(env), segment);
}

/**
 * Deprecated env-based roots used only as migration sources for the first
 * local-root consolidation. Prefer layout migrator for segment renames.
 */
export function resolveLegacyScopeRoot(scope: FileStorageScope, env: NodeJS.ProcessEnv = process.env): string {
  if (scope === Scopes.customerInvoices || scope === Scopes.customerOffers || scope === Scopes.customerTimesheets) {
    return (
      env.BILLING_INVOICE_PDF_STORAGE_PATH?.trim() ||
      path.join(process.cwd(), 'data', FILE_STORAGE_PREVIOUS_SCOPE_SEGMENTS.invoices)
    );
  }

  if (scope === Scopes.supplierInvoices) {
    return (
      env.BILLING_SUPPLIER_INVOICE_STORAGE_PATH?.trim() ||
      path.join(process.cwd(), 'data', FILE_STORAGE_PREVIOUS_SCOPE_SEGMENTS.supplierInvoices)
    );
  }

  return (
    env.BILLING_DATEV_EXPORT_STORAGE_PATH?.trim() ||
    path.join(process.cwd(), 'data', FILE_STORAGE_PREVIOUS_SCOPE_SEGMENTS.datevExports)
  );
}

export function isLegacyMigrationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FILE_STORAGE_LEGACY_MIGRATION_ENABLED?.trim().toLowerCase() !== 'false';
}

/** Layout split migrator (old segments → customer/supplier/export). Default on. */
export function isLayoutMigrationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FILE_STORAGE_LAYOUT_MIGRATION_ENABLED?.trim().toLowerCase() !== 'false';
}

/** Dual-read from previous segments when the new path is missing. Default on. */
export function isLayoutDualReadEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FILE_STORAGE_LAYOUT_DUAL_READ_ENABLED?.trim().toLowerCase() !== 'false';
}

export function readActiveFileStorageProviderType(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.FILE_STORAGE_PROVIDER?.trim();

  return configured || FILE_STORAGE_DEFAULT_PROVIDER;
}
