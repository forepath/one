import { KeycloakRoles, UserRole, UsersRoles } from '@forepath/identity/backend';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';

import { CreateInvoiceDto } from '../dto/create-invoice.dto';
import { InvoiceDetailResponseDto } from '../dto/invoice-detail-response.dto';
import { InitiatePaymentResponseDto, InvoiceResponseDto } from '../dto/invoice-response.dto';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { UsersBillingDayRepository } from '../repositories/users-billing-day.repository';
import { InvoiceCreationService } from '../services/invoice-creation.service';
import { InvoiceService } from '../services/invoice.service';
import { PaymentOrchestrationService } from '../services/payment-orchestration.service';
import { SubscriptionService } from '../services/subscription.service';
import { ensureAdmin, getUserFromRequest, type RequestWithUser } from '../utils/billing-access.utils';

export class InvoicesSummaryResponseDto {
  openOverdueCount!: number;
  openOverdueTotal!: number;
  billingDayOfMonth!: number;
  unbilledTotal!: number;
}

@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly invoiceCreationService: InvoiceCreationService,
    private readonly invoicesRepository: InvoicesRepository,
    private readonly subscriptionService: SubscriptionService,
    private readonly usersBillingDayRepository: UsersBillingDayRepository,
    private readonly paymentOrchestrationService: PaymentOrchestrationService,
    private readonly subscriptionsRepository: SubscriptionsRepository,
  ) {}

  @Get('summary')
  async getSummary(@Req() req?: RequestWithUser): Promise<InvoicesSummaryResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const [summary, billingDayOfMonth, unbilledTotal] = await Promise.all([
      this.invoicesRepository.findOpenOverdueSummaryByUserId(userInfo.userId),
      this.usersBillingDayRepository.getEffectiveBillingDayForUser(userInfo.userId),
      this.invoiceCreationService.getUnbilledTotalForUser(userInfo.userId),
    ]);

    return {
      openOverdueCount: summary.count,
      openOverdueTotal: summary.totalBalance,
      billingDayOfMonth,
      unbilledTotal,
    };
  }

  @Get('open-overdue')
  async listOpenOverdue(@Req() req?: RequestWithUser): Promise<InvoiceResponseDto[]> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const rows = await this.invoicesRepository.findOpenOverdueByUserId(userInfo.userId);

    return rows.map((row) => this.invoiceService.mapToResponse(row, row.subscription?.number));
  }

  @Get(':subscriptionId')
  async list(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Req() req?: RequestWithUser,
  ): Promise<InvoiceResponseDto[]> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    await this.subscriptionService.getSubscription(subscriptionId, userInfo.userId);
    const rows = await this.invoicesRepository.findBySubscription(userInfo.userId, subscriptionId);

    return rows.map((row) => this.invoiceService.mapToResponse(row));
  }

  @Get(':subscriptionId/ref/:invoiceRefId')
  async getDetail(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Param('invoiceRefId', new ParseUUIDPipe({ version: '4' })) invoiceRefId: string,
    @Req() req?: RequestWithUser,
  ): Promise<InvoiceDetailResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    await this.subscriptionService.getSubscription(subscriptionId, userInfo.userId);

    return await this.invoiceService.getDetail(invoiceRefId, subscriptionId);
  }

  @Get(':subscriptionId/ref/:invoiceRefId/pdf')
  @Header('Content-Type', 'application/pdf')
  async downloadPdf(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Param('invoiceRefId', new ParseUUIDPipe({ version: '4' })) invoiceRefId: string,
    @Req() req?: RequestWithUser,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<StreamableFile> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);

    if (subscription.userId !== userInfo.userId) {
      ensureAdmin(userInfo);
    }

    const invoice = await this.invoicesRepository.findByIdAndSubscriptionId(invoiceRefId, subscriptionId);

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    const buffer = await this.invoiceService.getPdfBuffer(invoiceRefId, subscriptionId);
    const filename = `${invoice.invoiceNumber ?? invoiceRefId}.pdf`;

    res?.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    return new StreamableFile(buffer);
  }

  @Get(':subscriptionId/ref/:invoiceRefId/void-document/pdf')
  @Header('Content-Type', 'application/pdf')
  async downloadVoidDocumentPdf(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Param('invoiceRefId', new ParseUUIDPipe({ version: '4' })) invoiceRefId: string,
    @Req() req?: RequestWithUser,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<StreamableFile> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);

    if (subscription.userId !== userInfo.userId) {
      ensureAdmin(userInfo);
    }

    const invoice = await this.invoicesRepository.findByIdAndSubscriptionId(invoiceRefId, subscriptionId);

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    const buffer = await this.invoiceService.getVoidPdfBuffer(invoiceRefId, subscriptionId);
    const filename = `${invoice.invoiceNumber ?? invoiceRefId}-void.pdf`;

    res?.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    return new StreamableFile(buffer);
  }

  @Post(':subscriptionId')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async create(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Body() dto: CreateInvoiceDto,
    @Req() req?: RequestWithUser,
  ) {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);

    if (subscription.userId !== userInfo.userId) {
      ensureAdmin(userInfo);
    }

    return await this.invoiceCreationService.createInvoice(subscriptionId, subscription.userId, dto.description, {
      billUntil: new Date(),
    });
  }

  @Post(':subscriptionId/ref/:invoiceRefId/void')
  @KeycloakRoles(UserRole.ADMIN)
  @UsersRoles(UserRole.ADMIN)
  async voidInvoice(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Param('invoiceRefId', new ParseUUIDPipe({ version: '4' })) invoiceRefId: string,
    @Req() req?: RequestWithUser,
  ): Promise<InvoiceResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);

    if (subscription.userId !== userInfo.userId) {
      ensureAdmin(userInfo);
    }

    const voided = await this.invoiceService.voidInvoice(invoiceRefId, subscriptionId, userInfo.userId, {
      adminUserId: userInfo.userId,
    });

    return this.invoiceService.mapToResponse(voided);
  }

  @Post(':subscriptionId/ref/:invoiceRefId/pay')
  async initiatePayment(
    @Param('subscriptionId', new ParseUUIDPipe({ version: '4' })) subscriptionId: string,
    @Param('invoiceRefId', new ParseUUIDPipe({ version: '4' })) invoiceRefId: string,
    @Req() req?: RequestWithUser,
  ): Promise<InitiatePaymentResponseDto> {
    const userInfo = getUserFromRequest(req || ({} as RequestWithUser));

    if (!userInfo.userId) {
      throw new BadRequestException('User not authenticated');
    }

    await this.subscriptionService.getSubscription(subscriptionId, userInfo.userId);

    return await this.paymentOrchestrationService.initiatePayment(invoiceRefId, subscriptionId, userInfo.userId);
  }
}
