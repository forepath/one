import { WebSocketGateway, SubscribeMessage } from '@nestjs/websockets';

import { InvoicesService } from '../services/invoices.service';

@WebSocketGateway({ namespace: 'demo/status' })
export class StatusGateway {
  constructor(private readonly invoicesService: InvoicesService) {}

  @SubscribeMessage('ping')
  handlePing() {
    return this.invoicesService.list();
  }
}
