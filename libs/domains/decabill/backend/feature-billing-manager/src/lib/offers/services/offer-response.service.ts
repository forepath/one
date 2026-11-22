import { BadRequestException, Injectable } from '@nestjs/common';

import { shouldNotify } from '../../dto/document-delivery.dto';
import { BillingEmailPublisher } from '../../email/billing-email.publisher';
import { BillingNotificationPublisher } from '../../notifications/billing-notification.publisher';
import { mapOfferToSearchDocument } from '../../search/billing-search-document.mapper';
import { BillingSearchIndexService } from '../../search/billing-search-index.service';
import { BillingAuditLogService } from '../../services/billing-audit-log.service';
import { CustomerProfilesService } from '../../services/customer-profiles.service';
import { getRequiredTenantId } from '../../utils/tenant-query.utils';
import { OfferStatus } from '../constants/offer-status.constants';
import type { OfferEntity } from '../entities/offer.entity';
import { OffersRepository } from '../repositories/offers.repository';
import { isOfferPastExpiry } from '../utils/offer-capabilities.util';

import { OfferFulfillmentService } from './offer-fulfillment.service';

/** Who answered the offer: the customer in their account, or an admin recording an answer given outside of it. */
export type OfferResponseActor = { kind: 'customer' } | { kind: 'admin'; adminUserId?: string };

export interface OfferAcceptOptions {
  /** Email the acceptance confirmation. Default `true`. */
  notifyCustomer?: boolean;
  /** Email the invoices issued right away by the acceptance. Default `true`. */
  notifyInvoices?: boolean;
}

export interface OfferDeclineOptions {
  /** Email the decline confirmation (admin only; a customer declining is not emailed). Default `true`. */
  notifyCustomer?: boolean;
}

const NOT_MODIFIABLE = 'Offer cannot be modified in its current status';

/**
 * Accepting and declining an offer, shared by the customer and the admin path so both apply the same checks
 * (archived, not expired, complete customer profile) and the same fulfillment. Callers resolve the offer
 * tenant-scoped (and, for customers, owner-scoped) first. The status change is an atomic claim, so concurrent
 * answers fulfill an offer exactly once.
 */
@Injectable()
export class OfferResponseService {
  constructor(
    private readonly offersRepository: OffersRepository,
    private readonly customerProfilesService: CustomerProfilesService,
    private readonly offerFulfillmentService: OfferFulfillmentService,
    private readonly billingEmailPublisher: BillingEmailPublisher,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
    private readonly billingSearchIndexService: BillingSearchIndexService,
    private readonly auditLog: BillingAuditLogService,
  ) {}

  async accept(offer: OfferEntity, actor: OfferResponseActor, options: OfferAcceptOptions = {}): Promise<OfferEntity> {
    if (offer.status !== OfferStatus.ARCHIVED) {
      throw new BadRequestException(NOT_MODIFIABLE);
    }

    if (isOfferPastExpiry(offer)) {
      throw new BadRequestException('Offer has expired');
    }

    const profile = await this.customerProfilesService.getByUserId(offer.userId);

    if (!this.customerProfilesService.isProfileComplete(profile)) {
      throw new BadRequestException('Customer profile must be complete before accepting offer');
    }

    if (
      !(await this.offersRepository.claimResponse(offer.id, { status: OfferStatus.ACCEPTED, acceptedAt: new Date() }))
    ) {
      throw new BadRequestException(NOT_MODIFIABLE);
    }

    const accepted = await this.offersRepository.findByIdOrThrow(offer.id, true);
    const notifyCustomer = actor.kind === 'customer' || shouldNotify(options.notifyCustomer);
    const notifyInvoices = actor.kind === 'customer' || shouldNotify(options.notifyInvoices);

    await this.auditLog.log({
      process: 'offer.accept',
      level: 'info',
      message: actor.kind === 'admin' ? 'Admin recorded offer acceptance' : 'Customer accepted offer',
      offerId: offer.id,
      userId: offer.userId,
      context: {
        offerNumber: accepted.offerNumber,
        ...(actor.kind === 'admin'
          ? { adminUserId: actor.adminUserId, recordedByAdmin: true, notifyCustomer, notifyInvoices }
          : {}),
      },
    });

    await this.offerFulfillmentService.fulfillAcceptedOffer(accepted.id, { skipInvoiceNotification: !notifyInvoices });

    if (notifyCustomer) {
      await this.billingEmailPublisher.publishOfferAcceptedConfirmation(accepted);
    }

    this.billingNotificationPublisher.publishOffer('offer.accepted', accepted);
    this.billingSearchIndexService.scheduleUpsert('offers', mapOfferToSearchDocument(accepted, getRequiredTenantId()));

    return accepted;
  }

  async decline(
    offer: OfferEntity,
    actor: OfferResponseActor,
    options: OfferDeclineOptions = {},
  ): Promise<OfferEntity> {
    if (offer.status !== OfferStatus.ARCHIVED) {
      throw new BadRequestException(NOT_MODIFIABLE);
    }

    if (
      !(await this.offersRepository.claimResponse(offer.id, { status: OfferStatus.DECLINED, declinedAt: new Date() }))
    ) {
      throw new BadRequestException(NOT_MODIFIABLE);
    }

    const declined = await this.offersRepository.findByIdOrThrow(offer.id, true);
    const emailed =
      actor.kind === 'admin' && shouldNotify(options.notifyCustomer)
        ? await this.billingEmailPublisher.publishOfferDeclinedConfirmation(declined)
        : false;

    await this.auditLog.log({
      process: 'offer.decline',
      level: 'info',
      message: actor.kind === 'admin' ? 'Admin recorded offer decline' : 'Customer declined offer',
      offerId: offer.id,
      userId: offer.userId,
      context: {
        offerNumber: declined.offerNumber,
        ...(actor.kind === 'admin'
          ? { adminUserId: actor.adminUserId, recordedByAdmin: true, customerNotified: emailed }
          : {}),
      },
    });

    this.billingNotificationPublisher.publishOffer('offer.declined', declined);
    this.billingSearchIndexService.scheduleUpsert('offers', mapOfferToSearchDocument(declined, getRequiredTenantId()));

    return declined;
  }
}
