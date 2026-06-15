import { Logger as NestLogger } from '@nestjs/common';
import type { Logger as TypeOrmLogger, QueryRunner } from 'typeorm';

import { sanitizeLogPayload } from './sanitize-log-payload';

/**
 * TypeORM logger that forwards to Nest logger so:
 * - correlation id is attached (via CorrelationAwareConsoleLogger)
 * - payloads are sanitized (via sanitizeLogPayload)
 */
export class CorrelationAwareTypeOrmLogger implements TypeOrmLogger {
  private readonly logger = new NestLogger('TypeORM');
  private readonly logQueries = process.env['TYPEORM_LOG_QUERIES'] === 'true';
  private readonly logParameters = process.env['TYPEORM_LOG_PARAMETERS'] === 'true';
  private readonly queryMaxLength = parseInt(process.env['TYPEORM_LOG_QUERY_MAXLEN'] ?? '500', 10);

  private truncateQuery(query: string): string {
    if (!query) {
      return '';
    }
    return query.length > this.queryMaxLength ? `${query.slice(0, this.queryMaxLength)}…` : query;
  }

  private maybeSanitizeParameters(parameters: unknown[] | undefined): unknown[] | undefined {
    if (!this.logParameters) {
      return undefined;
    }
    return sanitizeLogPayload(parameters) as unknown[] | undefined;
  }

  logQuery(query: string, parameters?: unknown[], queryRunner?: QueryRunner): void {
    if (!this.logQueries) {
      return;
    }
    this.logger.debug({
      msg: 'typeorm_query',
      query: this.truncateQuery(query),
      parameters: this.maybeSanitizeParameters(parameters),
    });
  }

  logQueryError(error: string | Error, query: string, parameters?: unknown[], queryRunner?: QueryRunner): void {
    this.logger.error(
      {
        msg: 'typeorm_query_error',
        query: this.truncateQuery(query),
        parameters: this.maybeSanitizeParameters(parameters),
        error: sanitizeLogPayload(error),
      },
      typeof error === 'string' ? undefined : error.stack,
    );
  }

  logQuerySlow(time: number, query: string, parameters?: unknown[], queryRunner?: QueryRunner): void {
    this.logger.warn({
      msg: 'typeorm_query_slow',
      time,
      query: this.truncateQuery(query),
      parameters: this.maybeSanitizeParameters(parameters),
    });
  }

  logSchemaBuild(message: string, queryRunner?: QueryRunner): void {
    this.logger.log({ msg: 'typeorm_schema_build', message: sanitizeLogPayload(message) });
  }

  logMigration(message: string, queryRunner?: QueryRunner): void {
    this.logger.log({ msg: 'typeorm_migration', message: sanitizeLogPayload(message) });
  }

  log(level: 'log' | 'info' | 'warn', message: unknown, queryRunner?: QueryRunner): void {
    const payload = { msg: 'typeorm_log', level, message: sanitizeLogPayload(message) };
    if (level === 'warn') {
      this.logger.warn(payload);
      return;
    }
    this.logger.log(payload);
  }
}
