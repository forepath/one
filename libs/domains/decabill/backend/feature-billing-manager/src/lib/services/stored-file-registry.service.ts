import {
  FileStorageService,
  type FileStorageScope as FileStorageScopeType,
} from '@forepath/shared/backend/util-file-storage';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Like, Repository } from 'typeorm';

import { StoredFileEntity } from '../entities/stored-file.entity';
import {
  computeStoredFileContentHashes,
  deriveStoredFileLongSha,
  shortShaFromLong,
} from '../utils/stored-file-hash.util';
import {
  signStoredFileV1,
  STORED_FILE_SIGNATURE_ALG,
  STORED_FILE_SIGNATURE_VERSION,
  verifyStoredFileV1,
} from '../utils/stored-file-signature.util';
import { StoredFileSigningConfigService } from './stored-file-signing-config.service';

export interface RegisterStoredFileInput {
  tenantId: string;
  scope: FileStorageScopeType | string;
  storageKey: string;
  content: Buffer;
}

export interface ReservedStoredFile {
  id: string;
  shas: { short: string; long: string };
}

@Injectable()
export class StoredFileRegistryService {
  private readonly logger = new Logger(StoredFileRegistryService.name);

  constructor(
    @InjectRepository(StoredFileEntity)
    private readonly storedFiles: Repository<StoredFileEntity>,
    private readonly fileStorage: FileStorageService,
    private readonly signingConfig: StoredFileSigningConfigService,
  ) {}

  isSigningEnabled(): boolean {
    return Boolean(this.signingConfig.getSecret());
  }

  /**
   * Create-or-get a registry row so PDF templates can stamp the identity short SHA
   * before content digests / HMAC exist.
   */
  async reserve(
    tenantId: string,
    scope: FileStorageScopeType | string,
    storageKey: string,
  ): Promise<ReservedStoredFile> {
    const normalizedKey = storageKey.replace(/\\/g, '/');
    let row = await this.storedFiles.findOne({
      where: { scope, storageKey: normalizedKey },
    });

    if (!row) {
      row = this.storedFiles.create({
        tenantId,
        scope: String(scope),
        storageKey: normalizedKey,
        longSha: '',
      });
      row = await this.storedFiles.save(row);
      row.longSha = deriveStoredFileLongSha(row.id);
      row = await this.storedFiles.save(row);
    } else {
      row.tenantId = tenantId;

      if (!row.longSha) {
        row.longSha = deriveStoredFileLongSha(row.id);
        row = await this.storedFiles.save(row);
      }
    }

    return {
      id: row.id,
      shas: this.toShas(row),
    };
  }

  async registerFromBuffer(input: RegisterStoredFileInput): Promise<StoredFileEntity> {
    const storageKey = input.storageKey.replace(/\\/g, '/');
    const hashes = computeStoredFileContentHashes(input.content);
    let row = await this.storedFiles.findOne({
      where: { scope: input.scope, storageKey },
    });

    if (!row) {
      row = this.storedFiles.create({
        tenantId: input.tenantId,
        scope: input.scope,
        storageKey,
        longSha: '',
      });
      row = await this.storedFiles.save(row);
      row.longSha = deriveStoredFileLongSha(row.id);
    } else {
      row.tenantId = input.tenantId;
      if (!row.longSha) {
        row.longSha = deriveStoredFileLongSha(row.id);
      }
    }

    row.contentMd5 = hashes.md5;
    row.contentSha1 = hashes.sha1;
    row.contentSha256 = hashes.sha256;
    row.contentSha512 = hashes.sha512;
    row.byteSize = String(hashes.byteSize);

    this.applySignature(row);

    return await this.storedFiles.save(row);
  }

  async findByScopeKey(scope: string, storageKey: string): Promise<StoredFileEntity | null> {
    return await this.storedFiles.findOne({
      where: { scope, storageKey: storageKey.replace(/\\/g, '/') },
    });
  }

  async findByContentSha256(contentSha256: string): Promise<StoredFileEntity[]> {
    if (!contentSha256) {
      return [];
    }

    return await this.storedFiles.find({
      where: { contentSha256 },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Resolve registry rows by printed document id (7-char short SHA) or full long SHA.
   */
  async findByDocumentId(documentId: string): Promise<StoredFileEntity[]> {
    const normalized = documentId.trim().toLowerCase();

    if (!/^[a-f0-9]{7}$/.test(normalized) && !/^[a-f0-9]{40}$/.test(normalized)) {
      return [];
    }

    if (normalized.length === 40) {
      return await this.storedFiles.find({
        where: { longSha: normalized },
        order: { createdAt: 'ASC' },
      });
    }

    return await this.storedFiles.find({
      where: { longSha: Like(`${normalized}%`) },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Verify uploaded bytes against a registry row without reading storage or persisting the upload.
   */
  verifyFromBuffer(row: StoredFileEntity, content: Buffer): boolean {
    const secret = this.signingConfig.getSecret();

    if (!secret || !row.signature || !row.contentMd5 || !row.contentSha256) {
      return false;
    }

    const hashes = computeStoredFileContentHashes(content);

    if (
      hashes.md5 !== row.contentMd5 ||
      hashes.sha1 !== row.contentSha1 ||
      hashes.sha256 !== row.contentSha256 ||
      hashes.sha512 !== row.contentSha512 ||
      String(hashes.byteSize) !== String(row.byteSize ?? '')
    ) {
      return false;
    }

    return verifyStoredFileV1(
      secret,
      {
        tenantId: row.tenantId,
        scope: row.scope,
        storageKey: row.storageKey,
        contentMd5: hashes.md5,
        contentSha1: hashes.sha1,
        contentSha256: hashes.sha256,
        contentSha512: hashes.sha512,
        byteSize: hashes.byteSize,
        registryFileId: row.id,
      },
      row.signature,
    );
  }

  async findMapForKeys(keys: Array<{ scope: string; storageKey: string }>): Promise<Map<string, StoredFileEntity>> {
    const map = new Map<string, StoredFileEntity>();

    if (keys.length === 0) {
      return map;
    }

    const scopes = [...new Set(keys.map((k) => k.scope))];
    const storageKeys = [...new Set(keys.map((k) => k.storageKey.replace(/\\/g, '/')))];
    const rows = await this.storedFiles.find({
      where: {
        scope: In(scopes),
        storageKey: In(storageKeys),
      },
    });

    for (const row of rows) {
      map.set(this.cacheKey(row.scope, row.storageKey), row);
    }

    return map;
  }

  cacheKey(scope: string, storageKey: string): string {
    return `${scope}::${storageKey.replace(/\\/g, '/')}`;
  }

  toShas(row: StoredFileEntity): { short: string; long: string } {
    const long = row.longSha || deriveStoredFileLongSha(row.id);

    return { short: shortShaFromLong(long), long };
  }

  async verifyFromStorage(row: StoredFileEntity): Promise<boolean> {
    const secret = this.signingConfig.getSecret();

    if (!secret || !row.signature || !row.contentMd5 || !row.contentSha256) {
      return false;
    }

    const buffer = await this.fileStorage.readFile(row.scope as FileStorageScopeType, row.storageKey);
    const hashes = computeStoredFileContentHashes(buffer);

    if (
      hashes.md5 !== row.contentMd5 ||
      hashes.sha1 !== row.contentSha1 ||
      hashes.sha256 !== row.contentSha256 ||
      hashes.sha512 !== row.contentSha512 ||
      String(hashes.byteSize) !== String(row.byteSize ?? '')
    ) {
      return false;
    }

    return verifyStoredFileV1(
      secret,
      {
        tenantId: row.tenantId,
        scope: row.scope,
        storageKey: row.storageKey,
        contentMd5: hashes.md5,
        contentSha1: hashes.sha1,
        contentSha256: hashes.sha256,
        contentSha512: hashes.sha512,
        byteSize: hashes.byteSize,
        registryFileId: row.id,
      },
      row.signature,
    );
  }

  async processBackfillBatch(
    limit: number,
    offset: number,
  ): Promise<{ processed: number; hasMore: boolean; nextOffset: number }> {
    const rows = await this.storedFiles.find({
      where: [{ contentSha256: IsNull() }, { signature: IsNull() }],
      order: { createdAt: 'ASC' },
      take: limit,
      skip: offset,
    });

    let processed = 0;

    for (const row of rows) {
      try {
        const buffer = await this.fileStorage.readFile(row.scope as FileStorageScopeType, row.storageKey);
        const hashes = computeStoredFileContentHashes(buffer);

        row.contentMd5 = hashes.md5;
        row.contentSha1 = hashes.sha1;
        row.contentSha256 = hashes.sha256;
        row.contentSha512 = hashes.sha512;
        row.byteSize = String(hashes.byteSize);

        if (!row.longSha) {
          row.longSha = deriveStoredFileLongSha(row.id);
        }

        this.applySignature(row);
        await this.storedFiles.save(row);
        processed += 1;
      } catch (error) {
        this.logger.warn(
          `Stored file backfill failed for ${row.scope}/${row.storageKey}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return {
      processed,
      hasMore: rows.length === limit,
      nextOffset: offset + rows.length,
    };
  }

  async countPendingBackfill(): Promise<number> {
    return await this.storedFiles.count({
      where: [{ contentSha256: IsNull() }, { signature: IsNull() }],
    });
  }

  private applySignature(row: StoredFileEntity): void {
    const secret = this.signingConfig.getSecret();

    if (
      !secret ||
      !row.contentMd5 ||
      !row.contentSha1 ||
      !row.contentSha256 ||
      !row.contentSha512 ||
      row.byteSize == null
    ) {
      return;
    }

    row.signature = signStoredFileV1(secret, {
      tenantId: row.tenantId,
      scope: row.scope,
      storageKey: row.storageKey,
      contentMd5: row.contentMd5,
      contentSha1: row.contentSha1,
      contentSha256: row.contentSha256,
      contentSha512: row.contentSha512,
      byteSize: row.byteSize,
      registryFileId: row.id,
    });
    row.signatureAlg = STORED_FILE_SIGNATURE_ALG;
    row.signatureVersion = STORED_FILE_SIGNATURE_VERSION;
    row.signedAt = new Date();
  }
}
