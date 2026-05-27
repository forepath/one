import { Injectable, Logger } from '@nestjs/common';

import { BackordersRepository } from '../repositories/backorders.repository';

import { BackorderService } from './backorder.service';

@Injectable()
export class BackorderRetryJobHandler {
  private readonly logger = new Logger(BackorderRetryJobHandler.name);
  private readonly batchSize = parseInt(process.env.BACKORDER_RETRY_BATCH_SIZE ?? '100', 10);

  constructor(
    private readonly backordersRepository: BackordersRepository,
    private readonly backorderService: BackorderService,
  ) {}

  async findPendingBackorderIds(): Promise<string[]> {
    const pending = await this.backordersRepository.findAllPending(this.batchSize, 0);

    return pending.map((backorder) => backorder.id);
  }

  async retryBackorder(backorderId: string): Promise<void> {
    await this.backorderService.retry(backorderId);
    this.logger.log(`Retried backorder ${backorderId}`);
  }
}
