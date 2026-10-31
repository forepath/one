import { CorrelationAwareConsoleLogger } from '@forepath/shared/backend/util-http-context';
import { Logger } from '@nestjs/common';

/**
 * The process' JSON logger (3.43 live test: the first lines after a restart were Nest's coloured text, written before
 * `bootstrap` installed this logger). `main.ts` installs it before anything else runs; the Nest app uses the same one.
 */
export const appLogger = new CorrelationAwareConsoleLogger({ json: true, colors: false });

/** Routes every `Logger` (static and instances) through {@link appLogger}; idempotent. */
export function installAppLogger(): CorrelationAwareConsoleLogger {
  Logger.overrideLogger(appLogger);

  return appLogger;
}
