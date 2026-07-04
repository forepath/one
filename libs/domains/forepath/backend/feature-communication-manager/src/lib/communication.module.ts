import { Module } from '@nestjs/common';

import { PublicContactRequestsController } from './controllers/public-contact-requests.controller';
import { ChatwootApiService } from './services/chatwoot-api.service';
import { ContactRequestService } from './services/contact-request.service';

@Module({
  controllers: [PublicContactRequestsController],
  providers: [ChatwootApiService, ContactRequestService],
  exports: [ContactRequestService],
})
export class CommunicationModule {}
