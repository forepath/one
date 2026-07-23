import { Controller, Get } from '@nestjs/common';

import { InvoicesService } from './services/invoices.service';
import { InvoicesRepository } from './repositories/invoices.repository';

@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly invoicesRepository: InvoicesRepository,
  ) {}

  @Get()
  list() {
    return this.invoicesService.list();
  }
}
