import { Controller, Get } from '@nestjs/common';

@Controller('invoices')
export class InvoicesController {
  @Get()
  list() {
    return [];
  }
}
