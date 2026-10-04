import { ZipArchive } from 'archiver';
import { PassThrough } from 'stream';

import { getTenantIdOrDefault, runWithTenantId } from '@forepath/shared/backend';
import {
  FILE_STORAGE_SCOPE_SEGMENTS,
  FileStorageScope,
  FileStorageService,
  type FileStorageScope as FileStorageScopeType,
} from '@forepath/shared/backend/util-file-storage';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import {
  ADMIN_FILE_MANAGER_MAX_ARCHIVE_BYTES,
  ADMIN_FILE_MANAGER_MAX_ARCHIVE_ENTRIES,
  AdminFileManagerView,
  type AdminFileManagerView as AdminFileManagerViewType,
} from '../constants/admin-file-manager.constants';
import { DatevExportScope, DatevExportStatus } from '../constants/datev-export.constants';
import type { AdminFileManagerEntryDto, AdminFileManagerListResponseDto } from '../dto/admin-file-manager.dto';
import type { StoredFileEntity } from '../entities/stored-file.entity';
import { resolveAdminViewTenant } from '../utils/admin-view-tenant.util';
import {
  buildTenantVirtualPath,
  buildUnifiedVirtualPath,
  guessContentType,
  isAdminFileManagerView,
  normalizeAdminFilePath,
  resolveScopeFromPathParts,
  structuralChildrenForPath,
} from '../utils/admin-file-manager-path.util';
import { BillingTenantService } from './billing-tenant.service';
import { StoredFileRegistryService } from './stored-file-registry.service';
import { StoredFileSigningConfigService } from './stored-file-signing-config.service';
import { TenantsGlobalViewsConfigService } from './tenants-global-views-config.service';

interface StoredFileRef {
  virtualPath: string;
  scope: FileStorageScopeType;
  storageKey: string;
  updatedAt?: Date;
  ownerTenantId: string;
}

@Injectable()
export class AdminFileManagerService {
  private readonly logger = new Logger(AdminFileManagerService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly fileStorage: FileStorageService,
    private readonly tenantsGlobalViewsConfig: TenantsGlobalViewsConfigService,
    private readonly billingTenantService: BillingTenantService,
    private readonly storedFileRegistry: StoredFileRegistryService,
    private readonly storedFileSigningConfig: StoredFileSigningConfigService,
  ) {}

  async listDirectory(
    rawPath?: string,
    viewRaw?: string,
    viewTenantId?: string,
  ): Promise<AdminFileManagerListResponseDto> {
    const view = this.resolveView(viewRaw);
    const { path, parts } = normalizeAdminFilePath(rawPath);
    const files = await this.collectFilesForView(view, viewTenantId);
    const registryMap = await this.storedFileRegistry.findMapForKeys(
      files.map((file) => ({ scope: file.scope, storageKey: file.storageKey })),
    );
    const entries = this.listEntriesAtPath(files, path, parts, registryMap, view);

    return {
      path,
      view,
      viewTenantId: view === AdminFileManagerView.TENANT ? this.resolveTenantViewId(viewTenantId) : undefined,
      entries,
    };
  }

  async downloadFile(
    rawPath?: string,
    viewRaw?: string,
    viewTenantId?: string,
  ): Promise<{ buffer: Buffer; fileName: string; contentType?: string }> {
    const view = this.resolveView(viewRaw);
    const { path } = normalizeAdminFilePath(rawPath);
    const files = await this.collectFilesForView(view, viewTenantId);
    const file = files.find((entry) => entry.virtualPath === path);

    if (!file) {
      throw new NotFoundException('File not found');
    }

    await this.logStoredFileIntegrity(file);

    const buffer = await this.fileStorage.readFile(file.scope, file.storageKey);
    const fileName = path.split('/').pop() || 'download';

    return {
      buffer,
      fileName,
      contentType: guessContentType(fileName),
    };
  }

  async downloadArchive(
    rawPath?: string,
    viewRaw?: string,
    viewTenantId?: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const view = this.resolveView(viewRaw);
    const { path } = normalizeAdminFilePath(rawPath);
    const files = await this.collectFilesForView(view, viewTenantId);
    const prefix = path.length > 0 ? `${path}/` : '';
    const matched = files.filter((entry) => (path.length === 0 ? true : entry.virtualPath.startsWith(prefix)));

    if (matched.length === 0) {
      throw new NotFoundException('Folder not found or empty');
    }

    if (matched.length > ADMIN_FILE_MANAGER_MAX_ARCHIVE_ENTRIES) {
      throw new PayloadTooLargeException('Archive exceeds maximum entry count');
    }

    const zipEntries: { name: string; content: Buffer }[] = [];
    let totalBytes = 0;

    for (const file of matched) {
      await this.logStoredFileIntegrity(file);

      const content = await this.fileStorage.readFile(file.scope, file.storageKey);

      totalBytes += content.byteLength;

      if (totalBytes > ADMIN_FILE_MANAGER_MAX_ARCHIVE_BYTES) {
        throw new PayloadTooLargeException('Archive exceeds maximum size');
      }

      const archiveName = path.length === 0 ? file.virtualPath : file.virtualPath.slice(prefix.length);

      zipEntries.push({ name: archiveName || file.storageKey.split('/').pop() || 'file', content });
    }

    const folderName = path.split('/').filter(Boolean).pop() || 'files';
    const buffer = await this.createZipBuffer(zipEntries);

    this.logger.log(`Admin file archive created with ${zipEntries.length} entries for path "${path}"`);

    return {
      buffer,
      fileName: `${folderName}.zip`,
    };
  }

  private resolveView(viewRaw?: string): AdminFileManagerViewType {
    const view = (viewRaw ?? AdminFileManagerView.TENANT).trim();

    if (!isAdminFileManagerView(view)) {
      throw new BadRequestException('View must be tenant or unified');
    }

    if (view === AdminFileManagerView.UNIFIED) {
      const requestTenantId = getTenantIdOrDefault();

      if (!this.tenantsGlobalViewsConfig.isGlobalViewsAllowedForTenant(requestTenantId)) {
        throw new ForbiddenException('Unified file explorer access is not allowed for this tenant');
      }
    }

    return view;
  }

  private resolveTenantViewId(viewTenantId?: string): string {
    return resolveAdminViewTenant(this.tenantsGlobalViewsConfig, viewTenantId);
  }

  /**
   * Best-effort integrity check for download/archive members.
   * Never blocks delivery: signing status is surfaced in list metadata and logs.
   */
  private async logStoredFileIntegrity(file: StoredFileRef): Promise<void> {
    const signingEnabled = Boolean(this.storedFileSigningConfig.getSecret());
    const registryRow = await this.storedFileRegistry.findByScopeKey(file.scope, file.storageKey);

    if (!registryRow?.signature) {
      if (signingEnabled) {
        this.logger.warn(`Stored file signature pending for ${file.scope}/${file.storageKey}`);
      }

      return;
    }

    const valid = await this.storedFileRegistry.verifyFromStorage(registryRow);

    if (!valid) {
      this.logger.error(`Stored file signature verification failed for ${file.scope}/${file.storageKey}`);
    }
  }

  private async collectFilesForView(view: AdminFileManagerViewType, viewTenantId?: string): Promise<StoredFileRef[]> {
    if (view === AdminFileManagerView.TENANT) {
      const tenantId = this.resolveTenantViewId(viewTenantId);

      return await runWithTenantId(tenantId, () => this.collectFilesForTenant(tenantId, false));
    }

    const tenantIds = [...this.billingTenantService.getConfiguredTenants()];
    const all: StoredFileRef[] = [];

    for (const tenantId of tenantIds) {
      const tenantFiles = await runWithTenantId(tenantId, () => this.collectFilesForTenant(tenantId, true));

      all.push(...tenantFiles);
    }

    const unifiedDatev = await this.collectUnifiedDatevFiles();

    all.push(...unifiedDatev);

    return all;
  }

  private async collectFilesForTenant(tenantId: string, unifiedLayout: boolean): Promise<StoredFileRef[]> {
    const refs: StoredFileRef[] = [];
    const invoiceSegment = FILE_STORAGE_SCOPE_SEGMENTS[FileStorageScope.customerInvoices];
    const offerSegment = FILE_STORAGE_SCOPE_SEGMENTS[FileStorageScope.customerOffers];
    const timesheetSegment = FILE_STORAGE_SCOPE_SEGMENTS[FileStorageScope.customerTimesheets];
    const supplierSegment = FILE_STORAGE_SCOPE_SEGMENTS[FileStorageScope.supplierInvoices];
    const datevSegment = FILE_STORAGE_SCOPE_SEGMENTS[FileStorageScope.datevExports];

    const invoiceRows: Array<{
      pdf_storage_key: string | null;
      time_report_storage_key: string | null;
      created_at: Date;
    }> = await this.dataSource.query(
      `
      SELECT i.pdf_storage_key, i.time_report_storage_key, i.created_at
      FROM billing_invoices i
      INNER JOIN users u ON u.id = i.user_id
      WHERE u.tenant_id = $1
        AND (i.pdf_storage_key IS NOT NULL OR i.time_report_storage_key IS NOT NULL)
      `,
      [tenantId],
    );

    for (const row of invoiceRows) {
      if (row.pdf_storage_key) {
        refs.push(
          this.toRef(
            tenantId,
            unifiedLayout,
            invoiceSegment,
            FileStorageScope.customerInvoices,
            row.pdf_storage_key,
            row.created_at,
          ),
        );
      }

      if (row.time_report_storage_key) {
        refs.push(
          this.toRef(
            tenantId,
            unifiedLayout,
            timesheetSegment,
            FileStorageScope.customerTimesheets,
            row.time_report_storage_key,
            row.created_at,
          ),
        );
      }
    }

    const voidRows: Array<{ pdf_storage_key: string; created_at: Date }> = await this.dataSource.query(
      `
      SELECT d.pdf_storage_key, d.created_at
      FROM billing_invoice_void_documents d
      INNER JOIN billing_invoices i ON i.id = d.invoice_id
      INNER JOIN users u ON u.id = i.user_id
      WHERE u.tenant_id = $1
      `,
      [tenantId],
    );

    for (const row of voidRows) {
      refs.push(
        this.toRef(
          tenantId,
          unifiedLayout,
          invoiceSegment,
          FileStorageScope.customerInvoices,
          row.pdf_storage_key,
          row.created_at,
        ),
      );
    }

    const creditRows: Array<{ pdf_storage_key: string; created_at: Date }> = await this.dataSource.query(
      `
      SELECT d.pdf_storage_key, d.created_at
      FROM billing_invoice_credit_documents d
      INNER JOIN billing_invoices i ON i.id = d.invoice_id
      INNER JOIN users u ON u.id = i.user_id
      WHERE u.tenant_id = $1
      `,
      [tenantId],
    );

    for (const row of creditRows) {
      refs.push(
        this.toRef(
          tenantId,
          unifiedLayout,
          invoiceSegment,
          FileStorageScope.customerInvoices,
          row.pdf_storage_key,
          row.created_at,
        ),
      );
    }

    const offerRows: Array<{ pdf_storage_key: string; updated_at: Date }> = await this.dataSource.query(
      `
      SELECT o.pdf_storage_key, o.updated_at
      FROM billing_offers o
      INNER JOIN users u ON u.id = o.user_id
      WHERE u.tenant_id = $1
        AND o.pdf_storage_key IS NOT NULL
      `,
      [tenantId],
    );

    for (const row of offerRows) {
      refs.push(
        this.toRef(
          tenantId,
          unifiedLayout,
          offerSegment,
          FileStorageScope.customerOffers,
          row.pdf_storage_key,
          row.updated_at,
        ),
      );
    }

    const supplierRows: Array<{ document_storage_key: string; created_at: Date }> = await this.dataSource.query(
      `
      SELECT si.document_storage_key, si.created_at
      FROM billing_supplier_invoices si
      INNER JOIN billing_supplier_profiles sp ON sp.id = si.supplier_id
      WHERE sp.tenant_id = $1
        AND si.document_storage_key IS NOT NULL
      `,
      [tenantId],
    );

    for (const row of supplierRows) {
      refs.push(
        this.toRef(
          tenantId,
          unifiedLayout,
          supplierSegment,
          FileStorageScope.supplierInvoices,
          row.document_storage_key,
          row.created_at,
        ),
      );
    }

    const datevRows: Array<{ storage_key: string; completed_at: Date | null; created_at: Date }> =
      await this.dataSource.query(
        `
      SELECT storage_key, completed_at, created_at
      FROM billing_datev_exports
      WHERE scope = $1
        AND tenant_id = $2
        AND status = $3
        AND storage_key IS NOT NULL
      `,
        [DatevExportScope.TENANT, tenantId, DatevExportStatus.COMPLETED],
      );

    for (const row of datevRows) {
      refs.push(
        this.toRef(
          tenantId,
          unifiedLayout,
          datevSegment,
          FileStorageScope.datevExports,
          row.storage_key,
          row.completed_at ?? row.created_at,
        ),
      );
    }

    return refs;
  }

  private async collectUnifiedDatevFiles(): Promise<StoredFileRef[]> {
    const datevSegment = FILE_STORAGE_SCOPE_SEGMENTS[FileStorageScope.datevExports];
    const rows: Array<{ storage_key: string; completed_at: Date | null; created_at: Date; tenant_id: string }> =
      await this.dataSource.query(
        `
      SELECT storage_key, completed_at, created_at, tenant_id
      FROM billing_datev_exports
      WHERE scope = $1
        AND status = $2
        AND storage_key IS NOT NULL
      `,
        [DatevExportScope.UNIFIED, DatevExportStatus.COMPLETED],
      );

    return rows.map((row) => ({
      virtualPath: buildUnifiedVirtualPath('_unified', datevSegment, row.storage_key),
      scope: FileStorageScope.datevExports,
      storageKey: row.storage_key,
      updatedAt: row.completed_at ?? row.created_at,
      ownerTenantId: row.tenant_id,
    }));
  }

  private toRef(
    tenantId: string,
    unifiedLayout: boolean,
    scopeSegment: string,
    scope: FileStorageScopeType,
    storageKey: string,
    updatedAt?: Date,
  ): StoredFileRef {
    const normalizedKey = storageKey.replace(/\\/g, '/');

    return {
      virtualPath: unifiedLayout
        ? buildUnifiedVirtualPath(tenantId, scopeSegment, normalizedKey)
        : buildTenantVirtualPath(scopeSegment, normalizedKey),
      scope,
      storageKey: normalizedKey,
      updatedAt,
      ownerTenantId: tenantId,
    };
  }

  private listEntriesAtPath(
    files: StoredFileRef[],
    path: string,
    parts: string[],
    registryMap: Map<string, StoredFileEntity>,
    view: AdminFileManagerViewType,
  ): AdminFileManagerEntryDto[] {
    const directories = new Map<string, AdminFileManagerEntryDto>();
    const fileEntries: AdminFileManagerEntryDto[] = [];
    const structuralChildren = structuralChildrenForPath(parts, view);

    if (structuralChildren) {
      for (const name of structuralChildren) {
        const childPath = path.length > 0 ? `${path}/${name}` : name;
        const childParts = [...parts, name];
        directories.set(name, {
          name,
          path: childPath,
          type: 'directory',
          scope: resolveScopeFromPathParts(childParts) ?? undefined,
        });
      }
    }

    if (parts.length === 0 && view === AdminFileManagerView.UNIFIED) {
      for (const file of files) {
        const first = file.virtualPath.split('/')[0];

        if (!first || directories.has(first)) {
          continue;
        }

        directories.set(first, {
          name: first,
          path: first,
          type: 'directory',
        });
      }
    }

    const prefix = path.length > 0 ? `${path}/` : '';

    for (const file of files) {
      if (file.virtualPath === path) {
        continue;
      }

      if (prefix.length > 0 && !file.virtualPath.startsWith(prefix)) {
        continue;
      }

      if (prefix.length === 0 && view === AdminFileManagerView.TENANT) {
        // Root structural folders already seeded; skip re-deriving from files.
        continue;
      }

      const remainder = prefix.length > 0 ? file.virtualPath.slice(prefix.length) : file.virtualPath;
      const [name, ...rest] = remainder.split('/');

      if (!name) {
        continue;
      }

      if (rest.length === 0) {
        const row = registryMap.get(this.storedFileRegistry.cacheKey(file.scope, file.storageKey));
        fileEntries.push(this.toFileEntryDto(file, name, row));
      } else if (!directories.has(name)) {
        const childParts = [...parts, name];
        directories.set(name, {
          name,
          path: path.length > 0 ? `${path}/${name}` : name,
          type: 'directory',
          scope: resolveScopeFromPathParts(childParts) ?? file.scope,
        });
      }
    }

    return [...directories.values(), ...fileEntries].sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    });
  }

  private toFileEntryDto(file: StoredFileRef, name: string, row?: StoredFileEntity): AdminFileManagerEntryDto {
    const entry: AdminFileManagerEntryDto = {
      name,
      path: file.virtualPath,
      type: 'file',
      scope: file.scope,
      contentType: guessContentType(name),
      updatedAt: file.updatedAt?.toISOString(),
    };

    if (!row) {
      entry.signature = { status: 'pending' };

      return entry;
    }

    const shas = this.storedFileRegistry.toShas(row);
    entry.id = row.id;
    entry.shas = shas;
    entry.byteSize = row.byteSize != null ? Number(row.byteSize) : undefined;
    entry.size = entry.byteSize;

    if (row.contentMd5 && row.contentSha1 && row.contentSha256 && row.contentSha512) {
      entry.contentHashes = {
        md5: row.contentMd5,
        sha1: row.contentSha1,
        sha256: row.contentSha256,
        sha512: row.contentSha512,
      };
    }

    entry.signature = row.signature
      ? {
          status: 'signed',
          alg: row.signatureAlg ?? undefined,
          version: row.signatureVersion ?? undefined,
          value: row.signature,
          signedAt: row.signedAt?.toISOString(),
          tenantId: row.tenantId,
        }
      : { status: 'pending' };

    return entry;
  }

  private async createZipBuffer(entries: { name: string; content: Buffer }[]): Promise<Buffer> {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];

    const done = new Promise<Buffer>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
      archive.on('error', reject);
    });

    archive.pipe(stream);

    for (const entry of entries) {
      archive.append(entry.content, { name: entry.name });
    }

    await archive.finalize();

    return await done;
  }
}
