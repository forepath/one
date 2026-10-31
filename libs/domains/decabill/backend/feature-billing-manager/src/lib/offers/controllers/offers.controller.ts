import { RequireScopes } from '@forepath/identity/backend';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';

import type {
  CustomerOfferDetailResponseDto,
  OffersSummaryResponseDto,
  PaginatedCustomerOffersResponseDto,
} from '../dto/offer.dto';
import { OffersCustomerService } from '../services/offers-customer.service';
import { getUserFromRequest, type RequestWithUser } from '../../utils/billing-access.utils';

/** Largest page of the customer offer lists. */
const MAX_CUSTOMER_OFFERS_LIMIT = 100;

function customerOffersWindow(limit?: number, offset?: number): { limit: number; offset: number } {
  return {
    limit: Math.min(Math.max(limit ?? 10, 1), MAX_CUSTOMER_OFFERS_LIMIT),
    offset: Math.max(offset ?? 0, 0),
  };
}

@Controller('offers')
export class OffersController {
  constructor(private readonly offersCustomerService: OffersCustomerService) {}

  @Get('summary')
  @RequireScopes('offers:read')
  async getSummary(@Req() req: RequestWithUser): Promise<OffersSummaryResponseDto> {
    const user = getUserFromRequest(req);

    if (!user.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.offersCustomerService.getSummary(user.userId);
  }

  @Get('pending')
  @RequireScopes('offers:read')
  async listPending(
    @Req() req: RequestWithUser,
    @Query('search') search?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<PaginatedCustomerOffersResponseDto> {
    const user = getUserFromRequest(req);

    if (!user.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const window = customerOffersWindow(limit, offset);

    return await this.offersCustomerService.listPending(user.userId, window.limit, window.offset, search);
  }

  @Get('history')
  @RequireScopes('offers:read')
  async listHistory(
    @Req() req: RequestWithUser,
    @Query('search') search?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<PaginatedCustomerOffersResponseDto> {
    const user = getUserFromRequest(req);

    if (!user.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const window = customerOffersWindow(limit, offset);

    return await this.offersCustomerService.listHistory(user.userId, window.limit, window.offset, search);
  }

  @Get(':offerRefId')
  @RequireScopes('offers:read')
  async getDetail(
    @Req() req: RequestWithUser,
    @Param('offerRefId', new ParseUUIDPipe({ version: '4' })) offerRefId: string,
  ): Promise<CustomerOfferDetailResponseDto> {
    const user = getUserFromRequest(req);

    if (!user.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.offersCustomerService.getDetail(user.userId, offerRefId);
  }

  @Get(':offerRefId/pdf')
  @RequireScopes('offers:read')
  @Header('Content-Type', 'application/pdf')
  async downloadPdf(
    @Req() req: RequestWithUser,
    @Param('offerRefId', new ParseUUIDPipe({ version: '4' })) offerRefId: string,
  ): Promise<StreamableFile> {
    const user = getUserFromRequest(req);

    if (!user.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const { buffer, filename } = await this.offersCustomerService.readPdf(user.userId, offerRefId);

    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Post(':offerRefId/accept')
  @RequireScopes('offers:write')
  async accept(
    @Req() req: RequestWithUser,
    @Param('offerRefId', new ParseUUIDPipe({ version: '4' })) offerRefId: string,
  ): Promise<CustomerOfferDetailResponseDto> {
    const user = getUserFromRequest(req);

    if (!user.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.offersCustomerService.accept(user.userId, offerRefId);
  }

  @Post(':offerRefId/decline')
  @RequireScopes('offers:write')
  async decline(
    @Req() req: RequestWithUser,
    @Param('offerRefId', new ParseUUIDPipe({ version: '4' })) offerRefId: string,
  ): Promise<CustomerOfferDetailResponseDto> {
    const user = getUserFromRequest(req);

    if (!user.userId) {
      throw new BadRequestException('User not authenticated');
    }

    return await this.offersCustomerService.decline(user.userId, offerRefId);
  }
}
