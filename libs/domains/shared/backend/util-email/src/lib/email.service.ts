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
 * Email service for sending transactional emails via SMTP.
 * - MailHog (development): SMTP_HOST=mailhog, SMTP_PORT=1025, no auth
 * - Production: Set SMTP_USER and SMTP_PASSWORD for authenticated SMTP. Use port 465 for SMTPS.
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
    if (!this.transporter) {
      this.logger.debug('Email not sent (SMTP not configured):', options.subject, 'to', options.to);

      return false;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html ?? options.text.replace(/\n/g, '<br>'),
        ...(options.attachments?.length ? { attachments: options.attachments } : {}),
      });
      this.logger.debug(`Email sent: ${options.subject} to ${options.to}`);

      return true;
    } catch (error) {
      this.logger.error(`Failed to send email to ${options.to}:`, error);

      return false;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Sends the standard email confirmation message (same for self-registration and admin actions).
   * The code is a 6-character alphanumeric code (A-Z, 0-9).
   */
  async sendConfirmationEmail(to: string, code: string): Promise<boolean> {
    return this.send({
      to,
      subject: 'Confirm your email',
      text: `Please confirm your email using the following code:\n\n${code}\n\nEnter this code on the confirmation page. The code will expire when you confirm.`,
      html: `<p>Please confirm your email using the following code:</p><p><strong>${code}</strong></p><p>Enter this code on the confirmation page. The code will expire when you confirm.</p>`,
    });
  }
}
