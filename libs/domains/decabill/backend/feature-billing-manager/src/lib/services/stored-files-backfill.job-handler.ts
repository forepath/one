import { Injectable } from '@nestjs/common';

import { StoredFileRegistryService } from './stored-file-registry.service';

export interface StoredFilesBackfillUnitResult {
  processed: number;
  hasMore: boolean;
  nextOffset: number;
}

@Injectable()
export class StoredFilesBackfillJobHandler {
  constructor(private readonly storedFileRegistry: StoredFileRegistryService) {}

  async processBackfillUnit(offset = 0, limit = 25): Promise<StoredFilesBackfillUnitResult> {
    return await this.storedFileRegistry.processBackfillBatch(limit, offset);
  }

  async hasPendingWork(): Promise<boolean> {
    return (await this.storedFileRegistry.countPendingBackfill()) > 0;
  }
}
