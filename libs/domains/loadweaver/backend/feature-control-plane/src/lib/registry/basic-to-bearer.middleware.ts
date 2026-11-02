import { AuthService, PAT_TOKEN_PREFIX } from '@forepath/identity/backend';
import { Injectable, Logger, NestMiddleware, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';

/** What exchanges a personal access token for the machine JWT the guards accept (`AuthService.exchangePat`). */
export interface PatExchanger {
  exchangePat(token: string): Promise<{ access_token: string }>;
}

/**
 * `docker login` sends the password as HTTP Basic to the token realm (3.22). For that route only, the password
 * (an API key or a personal access token) becomes a Bearer token, so the regular authentication guards decide.
 * A personal access token (`fp_pat_…`) is exchanged for its machine JWT first (as `POST /auth/token` does): the
 * guards only accept the exchanged JWT, so a raw PAT used to answer 401 — the documented `docker login` with a PAT
 * never worked (G5). A token that doesn't exchange stays as it is (the guards refuse it).
 */
@Injectable()
export class BasicToBearerMiddleware implements NestMiddleware {
  private readonly logger = new Logger(BasicToBearerMiddleware.name);

  constructor(@Optional() private readonly moduleRef?: ModuleRef) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const header = req.headers.authorization;

    if (header && /^Basic\s+/i.test(header)) {
      const decoded = Buffer.from(header.replace(/^Basic\s+/i, ''), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      let secret = separator >= 0 ? decoded.slice(separator + 1) : '';

      if (secret.startsWith(PAT_TOKEN_PREFIX)) secret = (await this.exchange(secret)) ?? secret;

      if (secret) req.headers.authorization = `Bearer ${secret}`;
      else delete req.headers.authorization;
    }

    next();
  }

  private async exchange(token: string): Promise<string | null> {
    let exchanger: PatExchanger | null = null;

    try {
      exchanger = this.moduleRef?.get<PatExchanger>(AuthService, { strict: false }) ?? null;
    } catch {
      exchanger = null;
    }

    if (!exchanger) return null;

    try {
      return (await exchanger.exchangePat(token)).access_token;
    } catch (error) {
      this.logger.debug(`personal access token not exchanged: ${(error as Error).message}`);

      return null;
    }
  }
}
