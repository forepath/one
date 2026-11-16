import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';

import {
  AGENT_CONTEXT_METADATA,
  AGENT_TOOL_METADATA,
  type AgentContextMetadata,
  type AgentToolMetadata,
} from './agent-harness.decorators';
import { AGENT_HARNESS_MODULE_OPTIONS, type AgentHarnessModuleOptions } from './agent-harness.options';
import { AgentHarnessService } from './agent-harness.service';

/** Registers `@AgentTool()` / `@AgentContext()` methods of singleton providers with the harness at module init. */
@Injectable()
export class AgentHarnessExplorer implements OnModuleInit {
  private readonly logger = new Logger(AgentHarnessExplorer.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly harness: AgentHarnessService,
    @Inject(AGENT_HARNESS_MODULE_OPTIONS) private readonly options: AgentHarnessModuleOptions,
  ) {}

  onModuleInit(): void {
    if (this.options.discover === false) {
      return;
    }

    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;

      if (!instance || typeof instance !== 'object') {
        continue;
      }

      const prototype = Object.getPrototypeOf(instance);

      if (!prototype) {
        continue;
      }

      for (const methodName of this.scanner.getAllMethodNames(prototype)) {
        const method = prototype[methodName];
        const tool = this.reflector.get<AgentToolMetadata | undefined>(AGENT_TOOL_METADATA, method);
        const context = this.reflector.get<AgentContextMetadata | undefined>(AGENT_CONTEXT_METADATA, method);

        if (!tool && !context) {
          continue;
        }

        if (!wrapper.isDependencyTreeStatic()) {
          // Request-scoped providers have no singleton instance; the run context replaces request scope.
          this.logger.warn(
            `Skipping agent harness method ${wrapper.name}.${methodName}: only singleton providers are supported`,
          );
          continue;
        }

        if (tool) {
          this.harness.registerTool({ ...tool, handler: (method as (...args: unknown[]) => unknown).bind(instance) });
          this.logger.log(`Registered agent tool '${tool.name}' (${wrapper.name}.${methodName})`);
        }

        if (context) {
          this.harness.registerContextProvider({
            ...context,
            provide: (method as (...args: unknown[]) => unknown).bind(instance),
          });
        }
      }
    }
  }
}
