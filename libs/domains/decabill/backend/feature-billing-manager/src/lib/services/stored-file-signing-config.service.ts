import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

/**
 * Global HMAC secret for billing stored-file signatures.
 * Production fails closed when the secret is missing.
 */
@Injectable()
export class StoredFileSigningConfigService implements OnModuleInit {
  private readonly logger = new Logger(StoredFileSigningConfigService.name);
  private secret: string | null = null;

  onModuleInit(): void {
    this.secret = this.readSecret(process.env);
    const isProd = (process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production';

    if (!this.secret && isProd) {
      throw new Error('BILLING_FILE_SIGNING_SECRET is required in production');
    }

    if (!this.secret) {
      this.logger.warn('BILLING_FILE_SIGNING_SECRET is unset; file signatures will not be created');
    }
  }

  getSecret(): string | null {
    return this.secret ?? this.readSecret(process.env);
  }

  requireSecret(): string {
    const secret = this.getSecret();

    if (!secret) {
      throw new Error('BILLING_FILE_SIGNING_SECRET is not configured');
    }

    return secret;
  }

  private readSecret(env: NodeJS.ProcessEnv): string | null {
    const value = env.BILLING_FILE_SIGNING_SECRET?.trim();

    return value && value.length > 0 ? value : null;
  }
}
