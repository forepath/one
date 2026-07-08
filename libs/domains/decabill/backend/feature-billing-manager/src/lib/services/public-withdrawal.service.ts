import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { EmailService } from '@forepath/shared/backend';

import { computePublicWithdrawalExpiresAt } from '../constants/public-withdrawal.config';
import type { ConfirmPublicWithdrawalDto } from '../dto/confirm-public-withdrawal.dto';
import type {
  PublicWithdrawalAddresseeDto,
  PublicWithdrawalConfirmResponseDto,
  PublicWithdrawalRequestResponseDto,
  PublicWithdrawalResumeStep,
  PublicWithdrawalVerifyCodeResponseDto,
} from '../dto/public-withdrawal-response.dto';
import type { RequestPublicWithdrawalDto } from '../dto/request-public-withdrawal.dto';
import type { VerifyPublicWithdrawalCodeDto } from '../dto/verify-public-withdrawal-code.dto';
import { PublicWithdrawalRequestsRepository } from '../repositories/public-withdrawal-requests.repository';
import { SubscriptionItemsRepository } from '../repositories/subscription-items.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import {
  isBillingIssuerConfiguredForPublicDisplay,
  mapBillingIssuerToAddressee,
} from '../utils/billing-issuer-addressee.utils';
import {
  isValidSubscriptionNumber,
  matchesCustomerProfile,
  normalizeSubscriptionNumber,
  PUBLIC_WITHDRAWAL_MATCH_ERROR,
} from '../utils/customer-profile-match.utils';
import { matchesSubscriptionDates } from '../utils/subscription-date-match.utils';
import {
  generateWithdrawalConfirmationCode,
  validateWithdrawalConfirmationCode,
} from '../utils/withdrawal-confirmation-code.utils';

import { BillingIssuerConfigService } from './billing-issuer-config.service';
import { SubscriptionService } from './subscription.service';

const INVALID_CODE_MESSAGE = 'Invalid or expired confirmation code';
const WITHDRAWAL_NOT_PERMITTED_MESSAGE = 'Withdrawal is not permitted for this subscription.';
const ADDRESSEE_UNAVAILABLE_MESSAGE = 'Withdrawal addressee information is temporarily unavailable.';

@Injectable()
export class PublicWithdrawalService {
  private readonly logger = new Logger(PublicWithdrawalService.name);

  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly subscriptionItemsRepository: SubscriptionItemsRepository,
    private readonly publicWithdrawalRequestsRepository: PublicWithdrawalRequestsRepository,
    private readonly subscriptionService: SubscriptionService,
    private readonly billingIssuerConfig: BillingIssuerConfigService,
    private readonly emailService: EmailService,
  ) {}

  getAddressee(): PublicWithdrawalAddresseeDto {
    const issuer = this.billingIssuerConfig.getConfig();

    if (!isBillingIssuerConfiguredForPublicDisplay(issuer)) {
      throw new ServiceUnavailableException(ADDRESSEE_UNAVAILABLE_MESSAGE);
    }

    return mapBillingIssuerToAddressee(issuer)!;
  }

  async requestWithdrawal(dto: RequestPublicWithdrawalDto): Promise<PublicWithdrawalRequestResponseDto> {
    const subscriptionNumber = normalizeSubscriptionNumber(dto.subscriptionNumber);

    if (!isValidSubscriptionNumber(subscriptionNumber)) {
      throw new BadRequestException(PUBLIC_WITHDRAWAL_MATCH_ERROR);
    }

    const match = await this.subscriptionsRepository.findByNumberWithBillingProfile(subscriptionNumber);

    if (!match) {
      throw new BadRequestException(PUBLIC_WITHDRAWAL_MATCH_ERROR);
    }

    const items = await this.subscriptionItemsRepository.findBySubscription(match.subscription.id);

    if (
      !matchesCustomerProfile(match.profile, {
        customerName: dto.customerName,
        email: dto.email,
        company: dto.company,
      }) ||
      !matchesSubscriptionDates(match.subscription, items, {
        orderedOn: dto.orderedOn,
        receivedOn: dto.receivedOn,
      })
    ) {
      throw new BadRequestException(PUBLIC_WITHDRAWAL_MATCH_ERROR);
    }

    const now = new Date();
    const activePending = await this.publicWithdrawalRequestsRepository.findActivePendingBySubscriptionId(
      match.subscription.id,
      now,
    );

    if (activePending) {
      const resumeStep: PublicWithdrawalResumeStep = activePending.codeVerifiedAt ? 'acknowledge' : 'code';

      return {
        requestId: activePending.id,
        resumed: true,
        resumeStep,
        message: 'Continue where you left off.',
      };
    }

    await this.publicWithdrawalRequestsRepository.invalidateExpiredOrConfirmedForSubscription(
      match.subscription.id,
      now,
    );

    const code = generateWithdrawalConfirmationCode();
    const expiresAt = computePublicWithdrawalExpiresAt(now);
    const request = await this.publicWithdrawalRequestsRepository.createRequest(match.subscription.id, code, expiresAt);

    const profileEmail = match.profile.email?.trim();

    if (profileEmail) {
      const sent = await this.emailService.sendWithdrawalConfirmationEmail(profileEmail, code, expiresAt);

      if (!sent) {
        this.logger.warn(`Withdrawal confirmation email was not sent to profile for request ${request.id}`);
      }
    }

    return {
      requestId: request.id,
      resumed: false,
      resumeStep: 'code',
      message: 'Check your email for a confirmation code.',
    };
  }

  async verifyWithdrawalCode(dto: VerifyPublicWithdrawalCodeDto): Promise<PublicWithdrawalVerifyCodeResponseDto> {
    const now = new Date();
    const request = await this.publicWithdrawalRequestsRepository.findPendingById(dto.requestId, now);

    if (!request) {
      throw new BadRequestException(INVALID_CODE_MESSAGE);
    }

    if (request.codeVerifiedAt) {
      return {
        resumeStep: 'acknowledge',
        message: 'Confirmation code accepted. Please acknowledge your withdrawal.',
      };
    }

    const normalizedCode = dto.code.trim().toUpperCase();

    if (!validateWithdrawalConfirmationCode(normalizedCode, request.confirmationCode)) {
      throw new BadRequestException(INVALID_CODE_MESSAGE);
    }

    await this.publicWithdrawalRequestsRepository.markCodeVerified(request.id, now);

    return {
      resumeStep: 'acknowledge',
      message: 'Confirmation code accepted. Please acknowledge your withdrawal.',
    };
  }

  async confirmWithdrawal(dto: ConfirmPublicWithdrawalDto): Promise<PublicWithdrawalConfirmResponseDto> {
    const now = new Date();
    const request = await this.publicWithdrawalRequestsRepository.findPendingById(dto.requestId, now);

    if (!request || !request.codeVerifiedAt) {
      throw new BadRequestException(INVALID_CODE_MESSAGE);
    }

    try {
      await this.subscriptionService.executeWithdrawal(request.subscriptionId);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw new BadRequestException(WITHDRAWAL_NOT_PERMITTED_MESSAGE);
      }

      throw error;
    }

    await this.publicWithdrawalRequestsRepository.markConfirmed(request.id, now);

    return {
      message: 'Your statutory withdrawal has been submitted successfully.',
    };
  }
}
