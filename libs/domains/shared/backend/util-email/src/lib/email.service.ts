import { Injectable, Logger } from '@nestjs/common';
import type { Transporter } from 'nodemailer';
import * as nodemailer from 'nodemailer';

export interface EmailAttachment {
  filename: string;
  content: Buffer;
}

export interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}

/**
 * Transport-only email service for SMTP delivery via nodemailer.
 * - MailHog (development): SMTP_HOST=mailhog, SMTP_PORT=1025, no auth
 * - Production: Set SMTP_USER and SMTP_PASSWORD for authenticated SMTP. Use port 465 for SMTPS.
 *
 * Content (subjects, Handlebars bodies) is owned by the notifications email channel.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter | null = null;
  private readonly from: string;
  private readonly enabled: boolean;

  constructor() {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '1025', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASSWORD;

    this.from = process.env.EMAIL_FROM || 'noreply@localhost';
    this.enabled = !!(host && port);

    if (this.enabled) {
      const secure = port === 465;
      const auth = user && pass ? { user, pass } : undefined;
      const ignoreTLS = !auth; // MailHog has no auth; production SMTP uses TLS when available

      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        ignoreTLS,
        ...(auth && { auth }),
      });
      this.logger.log(`Email service configured: ${host}:${port}${auth ? ' (authenticated)' : ''}`);
    } else {
      this.logger.warn('Email service disabled: SMTP_HOST and SMTP_PORT not set');
    }
  }

  async send(options: EmailOptions): Promise<boolean> {
    try {
      await this.sendOrThrow(options);

      return true;
    } catch (error) {
      if (!this.transporter) {
        return false;
      }

      this.logger.error(`Failed to send email to ${options.to}:`, error);

      return false;
    }
  }

  /**
   * Sends mail or throws so BullMQ workers can retry on SMTP failures.
   * Throws when SMTP is disabled so callers that require delivery fail closed at the job layer.
   */
  async sendOrThrow(options: EmailOptions): Promise<void> {
    if (!this.transporter) {
      this.logger.debug('Email not sent (SMTP not configured):', options.subject, 'to', options.to);
      throw new Error('Email service is disabled: SMTP_HOST and SMTP_PORT not set');
    }

    await this.transporter.sendMail({
      from: this.from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html ?? options.text.replace(/\n/g, '<br>'),
      ...(options.attachments?.length ? { attachments: options.attachments } : {}),
    });
    this.logger.debug(`Email sent: ${options.subject} to ${options.to}`);
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
