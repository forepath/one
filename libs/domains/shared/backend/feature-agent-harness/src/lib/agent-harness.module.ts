import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { AgentHarnessExplorer } from './agent-harness.explorer';
import {
  AGENT_HARNESS_MODULE_OPTIONS,
  type AgentHarnessModuleAsyncOptions,
  type AgentHarnessModuleOptions,
} from './agent-harness.options';
import { AgentHarnessService } from './agent-harness.service';

/**
 * Connects an application to one Agenstra agent through its OpenAI-compatible API.
 *
 * ```ts
 * @Module({
 *   imports: [
 *     AgentHarnessModule.forRootAsync({
 *       useFactory: () => agentHarnessOptionsFromEnv('BILLING_AGENT') ?? { … },
 *     }),
 *   ],
 *   providers: [InvoiceTools],
 * })
 * export class AppModule {}
 * ```
 */
@Module({})
export class AgentHarnessModule {
  static forRoot(options: AgentHarnessModuleOptions & { global?: boolean }): DynamicModule {
    const { global, ...moduleOptions } = options;

    return AgentHarnessModule.build([{ provide: AGENT_HARNESS_MODULE_OPTIONS, useValue: moduleOptions }], [], global);
  }

  static forRootAsync(options: AgentHarnessModuleAsyncOptions): DynamicModule {
    return AgentHarnessModule.build(
      [
        {
          provide: AGENT_HARNESS_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
      ],
      options.imports ?? [],
      options.global,
    );
  }

  private static build(
    optionProviders: Provider[],
    imports: NonNullable<DynamicModule['imports']>,
    global = true,
  ): DynamicModule {
    return {
      module: AgentHarnessModule,
      global,
      imports: [DiscoveryModule, ...imports],
      providers: [...optionProviders, AgentHarnessService, AgentHarnessExplorer],
      exports: [AgentHarnessService],
    };
  }
}
