import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { TurnstileCaptcha } from 'nest-cloudflare-turnstile';

import { ContactRequestResponseDto } from '../dto/contact-request-response.dto';
import { CreateContactRequestDto } from '../dto/create-contact-request.dto';
import { ContactRequestService } from '../services/contact-request.service';

@Controller('public/contact-requests')
export class PublicContactRequestsController {
  constructor(private readonly contactRequestService: ContactRequestService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @TurnstileCaptcha()
  submit(@Body() dto: CreateContactRequestDto): Promise<ContactRequestResponseDto> {
    return this.contactRequestService.submitContactRequest(dto);
  }
}
