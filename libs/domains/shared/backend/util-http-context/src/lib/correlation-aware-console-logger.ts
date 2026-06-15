import { ConsoleLogger, type ConsoleLoggerOptions, type LogLevel } from '@nestjs/common';

import { getCorrelationId } from './correlation-id.storage';
import { sanitizeLogPayload } from './sanitize-log-payload';

/**
 * Nest {@link ConsoleLogger} that adds request correlation from {@link getCorrelationId}
 * to each line (text mode) or as `correlationId` on JSON log records (when `json: true`).
 */
export class CorrelationAwareConsoleLogger extends ConsoleLogger {
  constructor();
  constructor(context: string);
  constructor(options: ConsoleLoggerOptions);
  constructor(context: string, options: ConsoleLoggerOptions);
  constructor(contextOrOptions?: string | ConsoleLoggerOptions, options?: ConsoleLoggerOptions) {
    if (typeof contextOrOptions === 'string') {
      if (options !== undefined) {
        super(contextOrOptions, options);
      } else {
        super(contextOrOptions);
      }
    } else if (contextOrOptions !== undefined) {
      super(contextOrOptions);
    } else {
      super();
    }
  }

  protected override formatMessage(
    logLevel: LogLevel,
    message: unknown,
    pidMessage: string,
    formattedLogLevel: string,
    contextMessage: string,
    timestampDiff: string,
  ): string {
    const correlationId = getCorrelationId();
    const correlationPrefix = correlationId && !this.options.json ? `[corr=${correlationId}] ` : '';
    const output = this.stringifyMessage(sanitizeLogPayload(message), logLevel);
    const coloredPid = this.colorize(pidMessage, logLevel);
    const coloredLevel = this.colorize(formattedLogLevel, logLevel);
    return `${coloredPid}${this.getTimestamp()} ${coloredLevel} ${correlationPrefix}${contextMessage}${output}${timestampDiff}\n`;
  }

  protected override getJsonLogObject(
    message: unknown,
    options: {
      context: string;
      logLevel: LogLevel;
      writeStreamType?: 'stdout' | 'stderr';
      errorStack?: unknown;
    },
  ) {
    const base = super.getJsonLogObject(sanitizeLogPayload(message), options);
    const correlationId = getCorrelationId();
    if (correlationId) {
      return { ...base, correlationId };
    }
    return base;
  }
}
