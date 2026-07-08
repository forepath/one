import { Public } from '@forepath/identity/backend';
import { Body, Controller, Get, Post, ServiceUnavailableException } from '@nestjs/common';

import { ConfirmPublicWithdrawalDto } from '../dto/confirm-public-withdrawal.dto';
import type { PublicWithdrawalAddresseeDto } from '../dto/public-withdrawal-response.dto';
import { RequestPublicWithdrawalDto } from '../dto/request-public-withdrawal.dto';
import { VerifyPublicWithdrawalCodeDto } from '../dto/verify-public-withdrawal-code.dto';
import { PublicWithdrawalService } from '../services/public-withdrawal.service';

@Controller('public/withdrawal')
@Public()
export class PublicWithdrawalController {
  constructor(private readonly publicWithdrawalService: PublicWithdrawalService) {}

  @Get('addressee')
  getAddressee(): PublicWithdrawalAddresseeDto {
    try {
      return this.publicWithdrawalService.getAddressee();
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      throw new ServiceUnavailableException('Withdrawal addressee information is temporarily unavailable.');
    }
  }

  @Post('request')
  requestWithdrawal(@Body() dto: RequestPublicWithdrawalDto) {
    return this.publicWithdrawalService.requestWithdrawal(dto);
  }

  @Post('verify-code')
  verifyCode(@Body() dto: VerifyPublicWithdrawalCodeDto) {
    return this.publicWithdrawalService.verifyWithdrawalCode(dto);
  }

  @Post('confirm')
  confirmWithdrawal(@Body() dto: ConfirmPublicWithdrawalDto) {
    return this.publicWithdrawalService.confirmWithdrawal(dto);
  }
}
