import { WebSocketGateway, SubscribeMessage } from '@nestjs/websockets';

@WebSocketGateway({ namespace: 'demo/status' })
export class StatusGateway {
  @SubscribeMessage('ping')
  handlePing() {
    return { ok: true };
  }
}
