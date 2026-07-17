import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EmailService, EmailTemplateRendererService, resolveEmailSubject } from '@forepath/shared/backend/util-email';

import {
  EMAIL_ATTACHMENT_RESOLVER,
  EMAIL_DELIVER_MAX_ATTEMPTS,
  NOTIFICATIONS_MODULE_OPTIONS,
} from '../constants/notification.constants';
import type { EmailAttachmentResolver, EmailDeliverJobPayload } from '../interfaces/notification.interfaces';
import type { NotificationsModuleOptions } from '../interfaces/notifications-module.options';
import { EmailDeliveriesRepository } from '../repositories/email-deliveries.repository';
import { sanitizeEmailTemplateContext } from '../utils/sanitize-email-template-context';

@Injectable()
export class EmailDeliveryService {
  private readonly logger = new Logger(EmailDeliveryService.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly templateRenderer: EmailTemplateRendererService,
    private readonly deliveriesRepository: EmailDeliveriesRepository,
    @Inject(NOTIFICATIONS_MODULE_OPTIONS) private readonly options: NotificationsModuleOptions,
    private readonly moduleRef: ModuleRef,
  ) {}

  async deliver(payload: EmailDeliverJobPayload): Promise<void> {
    const emailOptions = this.options.email;

    if (!emailOptions) {
      throw new Error('Email channel is not configured on NotificationsModule');
    }

    const maxAttempts = payload.maxAttempts ?? EMAIL_DELIVER_MAX_ATTEMPTS;
    const sanitizedContext = sanitizeEmailTemplateContext(payload.templateContext);
    const companyName = emailOptions.companyName?.trim() || emailOptions.companyFrom?.name?.trim() || undefined;
    const companyFrom = emailOptions.companyFrom;
    const renderContext: Record<string, unknown> = {
      ...payload.templateContext,
      ...(companyName ? { companyName } : {}),
      ...(companyFrom ? { companyFrom } : {}),
    };

    try {
      const subject = resolveEmailSubject(emailOptions.subjectRegistry, payload.templateKey, renderContext);
      const bodies = this.templateRenderer.render(emailOptions.templateRoots, payload.templateKey, renderContext);
      const attachments = await this.resolveAttachments(payload);

      await this.emailService.sendOrThrow({
        to: payload.to,
        subject,
        text: bodies.text,
        html: bodies.html,
        attachments,
      });

      await this.deliveriesRepository.create({
        eventId: payload.eventId,
        eventType: payload.eventType,
        scopeKey: payload.scopeKey,
        templateKey: payload.templateKey,
        recipient: payload.to,
        templateContext: sanitizedContext,
        success: true,
        attempt: payload.attempt,
        errorMessage: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Email delivery failed';

      await this.deliveriesRepository.create({
        eventId: payload.eventId,
        eventType: payload.eventType,
        scopeKey: payload.scopeKey,
        templateKey: payload.templateKey,
        recipient: payload.to,
        templateContext: sanitizedContext,
        success: false,
        attempt: payload.attempt,
        errorMessage: message,
      });

      this.logger.warn(
        `Email delivery failed for ${payload.eventType} (attempt ${payload.attempt}/${maxAttempts}): ${message}`,
      );

      throw error instanceof Error ? error : new Error(message);
    }
  }

  private async resolveAttachments(
    payload: EmailDeliverJobPayload,
  ): Promise<Array<{ filename: string; content: Buffer }> | undefined> {
    if (!payload.attachments?.length) {
      return undefined;
    }

    const resolver = this.lookupAttachmentResolver();

    if (!resolver) {
      throw new Error(
        `Email attachments present for ${payload.eventType} but EMAIL_ATTACHMENT_RESOLVER is not registered`,
      );
    }

    return await resolver.resolve(payload.attachments);
  }

  /**
   * Resolves the host-app attachment resolver across module boundaries.
   * NotificationsModule cannot inject BillingModule providers via constructor DI.
   */
  private lookupAttachmentResolver(): EmailAttachmentResolver | undefined {
    try {
      return this.moduleRef.get<EmailAttachmentResolver>(EMAIL_ATTACHMENT_RESOLVER, { strict: false });
    } catch {
      return undefined;
    }
  }
}
