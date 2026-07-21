import { Injectable } from '@nestjs/common';

import { AutoPaymentStatus } from '../constants/auto-payment-status.constants';
import { SubscriptionStatus } from '../entities/subscription.entity';
import { BackordersRepository } from '../repositories/backorders.repository';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { PaymentAttemptsRepository } from '../repositories/payment-attempts.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { CustomerProfilesService } from '../services/customer-profiles.service';

import { CUSTOMER_TRUST_SCORE_FACTOR_CONFIG } from './trust-score.constants';
import type { TrustScoreProvider } from './trust-score-provider.interface';
import type { CustomerTrustScoreFactor } from './trust-score.types';

@Injectable()
export class InternalBillingTrustScoreProvider implements TrustScoreProvider {
  readonly id = 'internal_billing';

  constructor(
    private readonly customerProfilesRepository: CustomerProfilesRepository,
    private readonly customerProfilesService: CustomerProfilesService,
    private readonly invoicesRepository: InvoicesRepository,
    private readonly paymentAttemptsRepository: PaymentAttemptsRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly backordersRepository: BackordersRepository,
  ) {}

  async evaluate(userId: string): Promise<CustomerTrustScoreFactor[]> {
    const profile = await this.customerProfilesRepository.findByUserId(userId);
    const subscriptions = await this.subscriptionsRepository.findAllForUserInTenant(userId);
    const openOverdueInvoices = await this.invoicesRepository.findOpenOverdueByUserId(userId);
    const onTimePaymentCount = await this.paymentAttemptsRepository.countSucceededOnTimeByUserId(userId);
    const failedPaymentCount = await this.paymentAttemptsRepository.countFailedByUserId(userId);
    const billedSubscriptionInvoiceCount =
      await this.invoicesRepository.countBilledSubscriptionInvoicesByUserId(userId);
    const hasAutoPaymentExhausted = await this.invoicesRepository.hasAutoPaymentExhaustedByUserId(userId);
    const backorderFailureCount = await this.backordersRepository.countFailedByUserId(userId);

    const factors: CustomerTrustScoreFactor[] = [];
    const hasSubscriptionHistory = subscriptions.length > 0;
    const hasWithdrawal = subscriptions.some(
      (subscription) =>
        subscription.status === SubscriptionStatus.PENDING_WITHDRAWAL || subscription.withdrawnAt != null,
    );

    if (profile && this.customerProfilesService.isProfileComplete(profile)) {
      factors.push({
        id: CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.profileComplete.id,
        label: 'Complete billing profile',
        description: 'The customer profile contains the billing data required for invoicing and ordering.',
        points: CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.profileComplete.points,
        source: this.id,
      });
    }

    if (hasSubscriptionHistory) {
      factors.push({
        id: CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.activeOrPastSubscription.id,
        label: 'Subscription history',
        description: 'The customer has at least one active or past subscription in Decabill.',
        points: CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.activeOrPastSubscription.points,
        source: this.id,
        metadata: { subscriptionCount: subscriptions.length },
      });
    }

    if (billedSubscriptionInvoiceCount >= 2) {
      factors.push({
        id: CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.multiPeriodTenure.id,
        label: 'Multi-period tenure',
        description: 'The customer has already been billed across at least two subscription billing periods.',
        points: CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.multiPeriodTenure.points,
        source: this.id,
        metadata: { billedSubscriptionInvoiceCount },
      });
    }

    const onTimePaymentsApplied = Math.min(onTimePaymentCount, CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.onTimePayments.cap);
    if (onTimePaymentsApplied > 0) {
      factors.push({
        id: CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.onTimePayments.id,
        label: 'On-time payments',
        description: `The customer has ${onTimePaymentsApplied} recorded payment attempt${
          onTimePaymentsApplied === 1 ? '' : 's'
        } completed on or before the invoice due date.`,
        points: onTimePaymentsApplied * CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.onTimePayments.points,
        source: this.id,
        metadata: { count: onTimePaymentCount, appliedCount: onTimePaymentsApplied },
      });
    }

    if (profile?.autoBillingEnabled && profile.defaultPaymentMethodExternalId && profile.stripeCustomerId) {
      factors.push({
        id: CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.autoBillingReady.id,
        label: 'Auto-billing ready',
        description: 'Auto-billing is enabled and a reusable payment method is on file.',
        points: CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.autoBillingReady.points,
        source: this.id,
      });
    }

    if (hasSubscriptionHistory && !hasWithdrawal) {
      factors.push({
        id: CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.noWithdrawal.id,
        label: 'No withdrawals recorded',
        description: 'The customer has subscription history without a recorded withdrawal.',
        points: CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.noWithdrawal.points,
        source: this.id,
      });
    }

    const overdueInvoiceCount = Math.min(
      openOverdueInvoices.length,
      CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.overdueInvoices.cap,
    );
    if (overdueInvoiceCount > 0) {
      factors.push({
        id: CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.overdueInvoices.id,
        label: 'Open or overdue invoices',
        description: `The customer currently has ${openOverdueInvoices.length} open or overdue invoice${
          openOverdueInvoices.length === 1 ? '' : 's'
        }.`,
        points: overdueInvoiceCount * CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.overdueInvoices.points,
        source: this.id,
        metadata: {
          count: openOverdueInvoices.length,
          appliedCount: overdueInvoiceCount,
        },
      });
    }

    const failedPaymentsApplied = Math.min(failedPaymentCount, CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.failedPayments.cap);
    if (failedPaymentsApplied > 0) {
      factors.push({
        id: CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.failedPayments.id,
        label: 'Failed payments',
        description: `The customer has ${failedPaymentCount} failed payment attempt${
          failedPaymentCount === 1 ? '' : 's'
        } recorded.`,
        points: failedPaymentsApplied * CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.failedPayments.points,
        source: this.id,
        metadata: { count: failedPaymentCount, appliedCount: failedPaymentsApplied },
      });
    }

    if (hasAutoPaymentExhausted) {
      factors.push({
        id: CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.autoPaymentExhausted.id,
        label: 'Auto-payment exhausted',
        description: `At least one invoice reached the auto-payment status "${AutoPaymentStatus.EXHAUSTED}".`,
        points: CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.autoPaymentExhausted.points,
        source: this.id,
      });
    }

    if (hasWithdrawal) {
      factors.push({
        id: CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.productWithdrawal.id,
        label: 'Withdrawal recorded',
        description: 'A statutory withdrawal was initiated or completed for at least one subscription.',
        points: CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.productWithdrawal.points,
        source: this.id,
      });
    }

    const backorderFailuresApplied = Math.min(
      backorderFailureCount,
      CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.backorderFailures.cap,
    );
    if (backorderFailuresApplied > 0) {
      factors.push({
        id: CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.backorderFailures.id,
        label: 'Backorder failures',
        description: `The customer has ${backorderFailureCount} failed backorder attempt${
          backorderFailureCount === 1 ? '' : 's'
        }.`,
        points: backorderFailuresApplied * CUSTOMER_TRUST_SCORE_FACTOR_CONFIG.backorderFailures.points,
        source: this.id,
        metadata: { count: backorderFailureCount, appliedCount: backorderFailuresApplied },
      });
    }

    return factors;
  }
}
