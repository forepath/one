import { ArgumentsHost, Catch, Injectable } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';

/** Controller-scoped: also covers scope guards, identity verification and validation errors. */
@Catch()
@Injectable()
export class SecretsResponseFilter extends BaseExceptionFilter {
  constructor(private readonly adapterHost: HttpAdapterHost) {
    super(adapterHost.httpAdapter);
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    this.adapterHost.httpAdapter.setHeader(host.switchToHttp().getResponse(), 'Cache-Control', 'no-store');
    super.catch(exception, host);
  }
}
