import { Inject, Injectable, Logger, Optional, OnModuleInit } from '@nestjs/common';

import { VatIdValidationSource, VatIdValidationStatus } from '../constants/vat-id-validation.constants';
import { normalizeVatCountryCode } from '../constants/eu-member-states.constants';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { VAT_ID_VALIDATION_ENQUEUE, type VatIdValidationEnqueuePort } from '../queue/vat-id-validation-enqueue.token';
import { extractVatIdCountryCode, isValidEuVatIdFormat, maskVatId, normalizeVatId } from '../utils/vat-id.utils';

export type ViesCapability = 'available' | 'unavailable';

export interface VatIdValidationResult {
  status: VatIdValidationStatus;
  source: VatIdValidationSource | null;
  validatedAt: Date | null;
  vatId: string | null;
}

const VIES_CHECK_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number';
const VIES_PROBE_TIMEOUT_MS = 5_000;
const VIES_SYNC_TIMEOUT_MS = 8_000;

@Injectable()
export class VatIdValidationService implements OnModuleInit {
  private readonly logger = new Logger(VatIdValidationService.name);
  private capability: ViesCapability = 'unavailable';

  constructor(
    private readonly notifications: BillingNotificationPublisher,
    @Optional() @Inject(VAT_ID_VALIDATION_ENQUEUE) private readonly enqueuePort?: VatIdValidationEnqueuePort,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.probeCapability();
  }

  getCapability(): ViesCapability {
    return this.capability;
  }

  async probeCapability(): Promise<ViesCapability> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), VIES_PROBE_TIMEOUT_MS);
      const response = await fetch(VIES_CHECK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ countryCode: 'DE', vatNumber: '000000000' }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      // Any HTTP response (including 4xx for invalid VAT) means the endpoint is reachable.
      this.capability = response.status > 0 ? 'available' : 'unavailable';
    } catch (error) {
      this.capability = 'unavailable';
      this.logger.warn(`VIES capability probe failed; falling back to format/admin validation: ${String(error)}`);
    }

    return this.capability;
  }

  /**
   * Validate (or schedule validation of) a VAT ID after format normalization.
   */
  async validateOnProfileChange(params: {
    profileId: string;
    userId: string;
    vatId: string | null | undefined;
    country?: string | null;
  }): Promise<VatIdValidationResult> {
    const normalized = normalizeVatId(params.vatId);

    if (!normalized) {
      return {
        status: VatIdValidationStatus.NONE,
        source: null,
        validatedAt: null,
        vatId: null,
      };
    }

    if (!isValidEuVatIdFormat(normalized)) {
      this.publishStatus(params.userId, params.profileId, VatIdValidationStatus.INVALID, normalized);

      return {
        status: VatIdValidationStatus.INVALID,
        source: VatIdValidationSource.FORMAT_ONLY,
        validatedAt: new Date(),
        vatId: normalized,
      };
    }

    if (this.capability === 'unavailable') {
      await this.probeCapability();
    }

    if (this.capability === 'unavailable') {
      this.notifications.publish(
        'vat_id.validation_unavailable',
        {
          profileId: params.profileId,
          userId: params.userId,
          vatIdMasked: maskVatId(normalized),
          status: VatIdValidationStatus.UNAVAILABLE,
        },
        params.userId,
      );

      return {
        status: VatIdValidationStatus.UNAVAILABLE,
        source: VatIdValidationSource.FORMAT_ONLY,
        validatedAt: null,
        vatId: normalized,
      };
    }

    try {
      const valid = await this.callVies(normalized);

      const status = valid ? VatIdValidationStatus.VALID : VatIdValidationStatus.INVALID;
      this.publishStatus(params.userId, params.profileId, status, normalized);

      return {
        status,
        source: VatIdValidationSource.VIES_SYNC,
        validatedAt: new Date(),
        vatId: normalized,
      };
    } catch (error) {
      this.logger.warn(
        `VIES sync validation failed for profile ${params.profileId} (${maskVatId(normalized)}): ${String(error)}`,
      );

      if (this.capability === 'available' && this.enqueuePort) {
        this.notifications.publish(
          'vat_id.validation_pending',
          {
            profileId: params.profileId,
            userId: params.userId,
            vatIdMasked: maskVatId(normalized),
            status: VatIdValidationStatus.PENDING,
          },
          params.userId,
        );

        await this.enqueuePort.enqueueUnit({
          profileId: params.profileId,
          userId: params.userId,
          vatId: normalized,
        });

        return {
          status: VatIdValidationStatus.PENDING,
          source: VatIdValidationSource.VIES_ASYNC,
          validatedAt: null,
          vatId: normalized,
        };
      }

      this.notifications.publish(
        'vat_id.validation_unavailable',
        {
          profileId: params.profileId,
          userId: params.userId,
          vatIdMasked: maskVatId(normalized),
          status: VatIdValidationStatus.UNAVAILABLE,
        },
        params.userId,
      );

      return {
        status: VatIdValidationStatus.UNAVAILABLE,
        source: VatIdValidationSource.FORMAT_ONLY,
        validatedAt: null,
        vatId: normalized,
      };
    }
  }

  async validateAsync(params: { profileId: string; userId: string; vatId: string }): Promise<VatIdValidationResult> {
    const normalized = normalizeVatId(params.vatId);

    if (!normalized || !isValidEuVatIdFormat(normalized)) {
      return {
        status: VatIdValidationStatus.INVALID,
        source: VatIdValidationSource.FORMAT_ONLY,
        validatedAt: new Date(),
        vatId: normalized,
      };
    }

    try {
      const valid = await this.callVies(normalized);
      const status = valid ? VatIdValidationStatus.VALID : VatIdValidationStatus.INVALID;
      this.publishStatus(params.userId, params.profileId, status, normalized);

      return {
        status,
        source: VatIdValidationSource.VIES_ASYNC,
        validatedAt: new Date(),
        vatId: normalized,
      };
    } catch (error) {
      this.logger.warn(`VIES async validation failed for profile ${params.profileId}: ${String(error)}`);

      return {
        status: VatIdValidationStatus.UNAVAILABLE,
        source: VatIdValidationSource.FORMAT_ONLY,
        validatedAt: null,
        vatId: normalized,
      };
    }
  }

  markValidatedByAdmin(vatId: string | null | undefined): VatIdValidationResult {
    const normalized = normalizeVatId(vatId);

    return {
      status: VatIdValidationStatus.VALID,
      source: VatIdValidationSource.ADMIN,
      validatedAt: new Date(),
      vatId: normalized,
    };
  }

  private async callVies(normalizedVatId: string): Promise<boolean> {
    const countryCode = extractVatIdCountryCode(normalizedVatId);
    const vatNumber = normalizedVatId.slice(2);

    if (!countryCode) {
      return false;
    }

    // VIES expects EL for Greece; normalizeVatCountryCode already maps GR→EL.
    const viesCountry = normalizeVatCountryCode(countryCode) ?? countryCode;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VIES_SYNC_TIMEOUT_MS);

    try {
      const response = await fetch(VIES_CHECK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ countryCode: viesCountry, vatNumber }),
        signal: controller.signal,
      });

      if (!response.ok && response.status >= 500) {
        throw new Error(`VIES HTTP ${response.status}`);
      }

      const body = (await response.json()) as { valid?: boolean };

      return Boolean(body.valid);
    } finally {
      clearTimeout(timer);
    }
  }

  private publishStatus(userId: string, profileId: string, status: VatIdValidationStatus, vatId: string): void {
    const event =
      status === VatIdValidationStatus.VALID
        ? 'vat_id.validation_succeeded'
        : status === VatIdValidationStatus.INVALID
          ? 'vat_id.validation_failed'
          : null;

    if (!event) {
      return;
    }

    this.notifications.publish(
      event,
      {
        profileId,
        userId,
        vatIdMasked: maskVatId(vatId),
        status,
      },
      userId,
    );
  }
}
