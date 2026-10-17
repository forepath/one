import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * `docker login` sends the password as HTTP Basic to the token realm (3.22). For that route only, the password
 * (an API key or a personal access token) becomes a Bearer token, so the regular authentication guards decide.
 */
@Injectable()
export class BasicToBearerMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const header = req.headers.authorization;

    if (header && /^Basic\s+/i.test(header)) {
      const decoded = Buffer.from(header.replace(/^Basic\s+/i, ''), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      const secret = separator >= 0 ? decoded.slice(separator + 1) : '';

      if (secret) req.headers.authorization = `Bearer ${secret}`;
      else delete req.headers.authorization;
    }

    next();
  }
}
