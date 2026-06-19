import { DynamicModule, Module, Type } from '@nestjs/common';

import type { ChatFilter } from '@forepath/agenstra/backend/util-plugin-host';
import type { ForepathExtension } from '@forepath/shared/backend/util-extension-core';

import { ChatFilterNoopProvider } from './chat-filter-noop.provider';

@Module({
  providers: [ChatFilterNoopProvider],
  exports: [ChatFilterNoopProvider],
})
class ChatFilterNoopExtensionModule {}

export function createChatFilterNoopExtension(): ForepathExtension<ChatFilter> {
  return {
    register(): DynamicModule {
      return {
        module: ChatFilterNoopExtensionModule,
        providers: [ChatFilterNoopProvider],
        exports: [ChatFilterNoopProvider],
      };
    },
    getInstanceToken(): Type<ChatFilter> {
      return ChatFilterNoopProvider;
    },
  };
}
