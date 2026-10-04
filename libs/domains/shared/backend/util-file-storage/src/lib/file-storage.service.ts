import { Injectable } from '@nestjs/common';

import {
  isLayoutDualReadEnabled,
  readActiveFileStorageProviderType,
  resolveCanonicalScopeRoot,
  resolvePreviousSegmentRoot,
} from './file-storage-path.config';
import { FileStorageProviderFactory } from './file-storage-provider.factory';
import {
  FILE_STORAGE_PREVIOUS_SCOPE_SEGMENTS,
  FileStorageScope,
  type FileStorageScope as FileStorageScopeType,
} from './file-storage-scope.constants';
import type { FileStorageProvider } from './file-storage-provider.interface';

/**
 * Facade for scope-aware file I/O. Resolves the active provider from
 * `FILE_STORAGE_PROVIDER` (default `local`) and canonical roots under `FILE_STORAGE_ROOT`.
 * When layout dual-read is enabled, reads/exists fall back to previous segment roots.
 */
@Injectable()
export class FileStorageService {
  constructor(private readonly factory: FileStorageProviderFactory) {}

  getActiveProvider(): FileStorageProvider {
    return this.factory.getProvider(readActiveFileStorageProviderType());
  }

  async writeFile(scope: FileStorageScopeType, storageKey: string, content: Buffer): Promise<void> {
    const root = resolveCanonicalScopeRoot(scope);

    await this.getActiveProvider().writeFile(root, storageKey, content);
  }

  async readFile(scope: FileStorageScopeType, storageKey: string): Promise<Buffer> {
    const root = resolveCanonicalScopeRoot(scope);
    const provider = this.getActiveProvider();

    try {
      return await provider.readFile(root, storageKey);
    } catch (error) {
      if (!isLayoutDualReadEnabled()) {
        throw error;
      }

      const fallback = this.resolveDualReadFallback(scope, storageKey);

      if (!fallback) {
        throw error;
      }

      return await provider.readFile(fallback.root, fallback.storageKey);
    }
  }

  async fileExists(scope: FileStorageScopeType, storageKey: string): Promise<boolean> {
    const root = resolveCanonicalScopeRoot(scope);
    const provider = this.getActiveProvider();

    if (await provider.fileExists(root, storageKey)) {
      return true;
    }

    if (!isLayoutDualReadEnabled()) {
      return false;
    }

    const fallback = this.resolveDualReadFallback(scope, storageKey);

    if (!fallback) {
      return false;
    }

    return await provider.fileExists(fallback.root, fallback.storageKey);
  }

  async writeCustomerInvoiceFile(storageKey: string, content: Buffer): Promise<void> {
    await this.writeFile(FileStorageScope.customerInvoices, storageKey, content);
  }

  async readCustomerInvoiceFile(storageKey: string): Promise<Buffer> {
    return await this.readFile(FileStorageScope.customerInvoices, storageKey);
  }

  async customerInvoiceFileExists(storageKey: string): Promise<boolean> {
    return await this.fileExists(FileStorageScope.customerInvoices, storageKey);
  }

  async writeCustomerOfferFile(storageKey: string, content: Buffer): Promise<void> {
    await this.writeFile(FileStorageScope.customerOffers, storageKey, content);
  }

  async readCustomerOfferFile(storageKey: string): Promise<Buffer> {
    return await this.readFile(FileStorageScope.customerOffers, storageKey);
  }

  async customerOfferFileExists(storageKey: string): Promise<boolean> {
    return await this.fileExists(FileStorageScope.customerOffers, storageKey);
  }

  async writeCustomerTimesheetFile(storageKey: string, content: Buffer): Promise<void> {
    await this.writeFile(FileStorageScope.customerTimesheets, storageKey, content);
  }

  async readCustomerTimesheetFile(storageKey: string): Promise<Buffer> {
    return await this.readFile(FileStorageScope.customerTimesheets, storageKey);
  }

  async customerTimesheetFileExists(storageKey: string): Promise<boolean> {
    return await this.fileExists(FileStorageScope.customerTimesheets, storageKey);
  }

  /** @deprecated Use writeCustomerInvoiceFile */
  async writeInvoiceFile(storageKey: string, content: Buffer): Promise<void> {
    await this.writeCustomerInvoiceFile(storageKey, content);
  }

  /** @deprecated Use readCustomerInvoiceFile */
  async readInvoiceFile(storageKey: string): Promise<Buffer> {
    return await this.readCustomerInvoiceFile(storageKey);
  }

  /** @deprecated Use customerInvoiceFileExists */
  async invoiceFileExists(storageKey: string): Promise<boolean> {
    return await this.customerInvoiceFileExists(storageKey);
  }

  async writeDatevExportFile(storageKey: string, content: Buffer): Promise<void> {
    await this.writeFile(FileStorageScope.datevExports, storageKey, content);
  }

  async readDatevExportFile(storageKey: string): Promise<Buffer> {
    return await this.readFile(FileStorageScope.datevExports, storageKey);
  }

  async datevExportFileExists(storageKey: string): Promise<boolean> {
    return await this.fileExists(FileStorageScope.datevExports, storageKey);
  }

  async writeSupplierInvoiceFile(storageKey: string, content: Buffer): Promise<void> {
    await this.writeFile(FileStorageScope.supplierInvoices, storageKey, content);
  }

  async readSupplierInvoiceFile(storageKey: string): Promise<Buffer> {
    return await this.readFile(FileStorageScope.supplierInvoices, storageKey);
  }

  async supplierInvoiceFileExists(storageKey: string): Promise<boolean> {
    return await this.fileExists(FileStorageScope.supplierInvoices, storageKey);
  }

  private resolveDualReadFallback(
    scope: FileStorageScopeType,
    storageKey: string,
  ): { root: string; storageKey: string } | null {
    switch (scope) {
      case FileStorageScope.customerInvoices:
      case FileStorageScope.customerTimesheets:
        return {
          root: resolvePreviousSegmentRoot(FILE_STORAGE_PREVIOUS_SCOPE_SEGMENTS.invoices),
          storageKey,
        };
      case FileStorageScope.customerOffers: {
        const withOffersPrefix = storageKey.replace(/\\/g, '/').startsWith('offers/')
          ? storageKey
          : `offers/${storageKey}`;

        return {
          root: resolvePreviousSegmentRoot(FILE_STORAGE_PREVIOUS_SCOPE_SEGMENTS.invoices),
          storageKey: withOffersPrefix,
        };
      }
      case FileStorageScope.supplierInvoices:
        return {
          root: resolvePreviousSegmentRoot(FILE_STORAGE_PREVIOUS_SCOPE_SEGMENTS.supplierInvoices),
          storageKey,
        };
      case FileStorageScope.datevExports:
        return {
          root: resolvePreviousSegmentRoot(FILE_STORAGE_PREVIOUS_SCOPE_SEGMENTS.datevExports),
          storageKey,
        };
      default:
        return null;
    }
  }
}
