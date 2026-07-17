import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EmailService, EmailTemplateRendererService, resolveEmailSubject } from '@forepath/shared/backend/util-email';

import {
  EMAIL_ATTACHMENT_RESOLVER,
  EMAIL_DELIVER_MAX_ATTEMPTS,
  NOTIFICATIONS_MODULE_OPTIONS,
} from '../constants/notification.constants';
import type { EmailAttachmentResolver, EmailDeliverJobPayload } from '../interfaces/notification.interfaces';
import type { NotificationsModuleOptions } from '../interfaces/notifications-module.options';
import { EmailDeliveriesRepository } from '../repositories/email-deliveries.repository';
import { assertEmailDeliveryAllowed } from '../utils/assert-email-delivery-allowed';
import { sanitizeEmailTemplateContext } from '../utils/sanitize-email-template-context';
import { unsealEmailTemplateContext } from '../utils/seal-email-template-context';

@Injectable()
export class EmailDeliveryService {
  private readonly logger = new Logger(EmailDeliveryService.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly templateRenderer: EmailTemplateRendererService,
    private readonly deliveriesRepository: EmailDeliveriesRepository,
    @Inject(NOTIFICATIONS_MODULE_OPTIONS) private readonly options: NotificationsModuleOptions,
    @Optional()
    @Inject(EMAIL_ATTACHMENT_RESOLVER)
    private readonly attachmentResolver: EmailAttachmentResolver | null = null,
  ) {}

  async deliver(payload: EmailDeliverJobPayload): Promise<void> {
    const emailOptions = this.options.email;

    if (!emailOptions) {
      throw new Error('Email channel is not configured on NotificationsModule');
    }

    assertEmailDeliveryAllowed(emailOptions, payload.eventType, payload.templateKey);

    const maxAttempts = payload.maxAttempts ?? EMAIL_DELIVER_MAX_ATTEMPTS;
    const templateContext = unsealEmailTemplateContext(payload.templateContext, payload.encryptedTemplateSecrets);
    const sanitizedContext = sanitizeEmailTemplateContext(templateContext);
    const companyName = emailOptions.resolveCompanyName?.().trim() || undefined;
    const companyFrom = emailOptions.resolveCompanyFrom?.();
    const renderContext: Record<string, unknown> = {
      ...templateContext,
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

    if (!this.attachmentResolver) {
      throw new Error(
        `Email attachments present for ${payload.eventType} but EMAIL_ATTACHMENT_RESOLVER is not registered`,
      );
    }

    return await this.attachmentResolver.resolve(payload.attachments);
  }
}
