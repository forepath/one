import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { getTenantId } from '@forepath/shared/backend/util-http-context';
import { recordSharedCounter, recordSharedHistogram } from '@forepath/shared/backend/util-otel';
import {
  GLOBAL_SETTINGS_SCOPE,
  getTenantSettingOverride,
  resolveSettingValue,
} from '@forepath/shared/backend/util-settings-overrides';
import { isPrivateOrLoopbackIp } from '@forepath/shared/shared/util-network-address';
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
/** Ports a tenant-supplied SMTP server may use. */
const TENANT_SMTP_PORTS = [25, 465, 587, 2525];
const MAX_CACHED_TRANSPORTS = 32;

interface SmtpSettings {
  host: string | undefined;
  port: number;
  user: string | undefined;
  pass: string | undefined;
  from: string;
  /** Host comes from a tenant override (untrusted input: must resolve to public addresses in production). */
  tenantSupplied: boolean;
}

interface ResolvedTransport {
  signature: string;
  transporter: Transporter;
  from: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transports = new Map<string, ResolvedTransport>();

  constructor() {
    const settings = this.readSettings();

    if (settings.host && settings.port) {
      this.logger.log(
        `Email service configured: ${settings.host}:${settings.port}${settings.user && settings.pass ? ' (authenticated)' : ''}`,
      );

      if (!settings.tenantSupplied) {
        const transport = this.createTransport(settings, settings.host);

        this.transports.set(transport.signature, transport);
      }
    } else {
      this.logger.warn('Email service disabled: SMTP_HOST and SMTP_PORT not set');
    }
  }

  /**
   * SMTP settings are read per send (console overrides apply without restart; in Decabill per tenant).
   *
   * Tenant SMTP settings apply only as a set, when the tenant configures its own `SMTP_HOST`: port, credentials and
   * sender then come from the tenant level only, so deployment credentials are never sent to a tenant-chosen server.
   * Without a tenant host, tenant SMTP / sender overrides are ignored, so the deployment relay cannot be used to send
   * as arbitrary senders.
   */
  private readSettings(): SmtpSettings {
    const tenantId = getTenantId();
    const tenantHost = tenantId ? getTenantSettingOverride('SMTP_HOST', tenantId)?.trim() : undefined;

    if (tenantId && tenantHost) {
      const own = (key: string): string | undefined => getTenantSettingOverride(key, tenantId) || undefined;

      return {
        host: tenantHost,
        port: parseInt(own('SMTP_PORT') || '587', 10),
        user: own('SMTP_USER'),
        pass: own('SMTP_PASSWORD'),
        from: own('EMAIL_FROM') || this.deploymentValue('EMAIL_FROM') || 'noreply@localhost',
        tenantSupplied: true,
      };
    }

    return {
      host: this.deploymentValue('SMTP_HOST')?.trim() || undefined,
      port: parseInt(this.deploymentValue('SMTP_PORT') || '1025', 10),
      user: this.deploymentValue('SMTP_USER') || undefined,
      pass: this.deploymentValue('SMTP_PASSWORD') || undefined,
      from: this.deploymentValue('EMAIL_FROM') || 'noreply@localhost',
      tenantSupplied: false,
    };
  }

  /** Override for all tenants, else the environment variable (tenant overrides ignored). */
  private deploymentValue(key: string): string | undefined {
    return resolveSettingValue(key, GLOBAL_SETTINGS_SCOPE);
  }

  private createTransport(settings: SmtpSettings, connectHost: string): ResolvedTransport {
    const { port, user, pass } = settings;
    const secure = port === 465;
    const auth = user && pass ? { user, pass } : undefined;
    const ignoreTLS = !auth; // MailHog has no auth; production SMTP uses TLS when available
    const pinned = connectHost !== settings.host;
    const transporter = nodemailer.createTransport({
      host: connectHost,
      port,
      secure,
      ignoreTLS,
      ...(pinned ? { tls: { servername: settings.host } } : {}),
      ...(auth && { auth }),
    });

    return { signature: this.signature(settings, connectHost), transporter, from: settings.from };
  }

  private signature(settings: SmtpSettings, connectHost: string): string {
    return JSON.stringify([settings.host, connectHost, settings.port, settings.user, settings.pass, settings.from]);
  }

  private async resolveTransport(): Promise<ResolvedTransport | null> {
    const settings = this.readSettings();

    if (!settings.host || !settings.port) {
      return null;
    }

    const connectHost = settings.tenantSupplied
      ? await this.resolvePublicHost(settings.host, settings.port)
      : settings.host;
    const signature = this.signature(settings, connectHost);
    const cached = this.transports.get(signature);

    if (cached) {
      return cached;
    }

    // Non-pooled transports open one connection per message, so evicted entries need no close() (a send of another
    // tenant may still use them).
    if (this.transports.size >= MAX_CACHED_TRANSPORTS) {
      this.transports.delete(this.transports.keys().next().value as string);
    }

    const created = this.createTransport(settings, connectHost);

    this.transports.set(signature, created);

    return created;
  }

  /**
   * Tenant-supplied SMTP servers must be public (SSRF): only SMTP ports, no private / loopback / link-local
   * addresses. The connection is pinned to the checked address so DNS rebinding cannot swap it afterwards.
   */
  private async resolvePublicHost(host: string, port: number): Promise<string> {
    if (!TENANT_SMTP_PORTS.includes(port)) {
      throw new Error(`SMTP port override must be one of ${TENANT_SMTP_PORTS.join(', ')}`);
    }

    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });

    if (addresses.length === 0 || addresses.some((entry) => isPrivateOrLoopbackIp(entry.address))) {
      throw new Error('SMTP host override resolves to a private or loopback address');
    }

    return addresses[0].address;
  }

  async send(options: EmailOptions): Promise<boolean> {
    try {
      await this.sendOrThrow(options);

      return true;
    } catch (error) {
      if (!this.isEnabled()) {
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
    const resolved = await this.resolveTransport();

    if (!resolved) {
      this.logger.debug('Email not sent (SMTP not configured):', options.subject, 'to', options.to);
      recordSharedCounter('email.smtp.send_total', { outcome: 'disabled' });
      throw new Error('Email service is disabled: SMTP_HOST and SMTP_PORT not set');
    }

    const startedAt = Date.now();

    try {
      await resolved.transporter.sendMail({
        from: resolved.from,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html ?? options.text.replace(/\n/g, '<br>'),
        ...(options.attachments?.length ? { attachments: options.attachments } : {}),
      });
      const durationMs = Date.now() - startedAt;

      recordSharedCounter('email.smtp.send_total', { outcome: 'success' });
      recordSharedHistogram('email.smtp.send_duration_ms', durationMs, { outcome: 'success' });
      this.logger.debug(`Email sent: ${options.subject} to ${options.to}`);
    } catch (error) {
      const durationMs = Date.now() - startedAt;

      recordSharedCounter('email.smtp.send_total', { outcome: 'failed' });
      recordSharedHistogram('email.smtp.send_duration_ms', durationMs, { outcome: 'failed' });
      throw error;
    }
  }

  isEnabled(): boolean {
    const settings = this.readSettings();

    return !!(settings.host && settings.port);
  }
}
