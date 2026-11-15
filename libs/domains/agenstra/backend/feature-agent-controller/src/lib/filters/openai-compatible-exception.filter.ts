import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

import { toOpenAiError } from '../utils/openai-compatible-errors';

/**
 * Renders every error of the OpenAI-compatible routes (guards, pipes, handlers) as an OpenAI error envelope so
 * OpenAI SDKs surface status and message. Once an SSE stream has started the error is written as a final stream event.
 */
@Catch()
export class OpenAiCompatibleExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(OpenAiCompatibleExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = toOpenAiError(exception);

    if (!(exception instanceof HttpException) && status >= 500) {
      this.logger.error(`OpenAI-compatible request failed: ${(exception as Error)?.message ?? String(exception)}`);
    }

    if (response.headersSent) {
      if (!response.writableEnded) {
        response.write(`data: ${JSON.stringify(body)}\n\n`);
        response.end();
      }

      return;
    }

    response.status(status).json(body);
  }
}
