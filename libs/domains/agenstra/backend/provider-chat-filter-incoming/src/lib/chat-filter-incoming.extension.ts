import { DynamicModule, Module, Type } from '@nestjs/common';

import type { ChatFilter } from '@forepath/agenstra/backend/util-plugin-host';
import type { ForepathExtension } from '@forepath/shared/backend/util-extension-core';

import { ChatFilterIncomingProvider } from './chat-filter-incoming.provider';

@Module({
  providers: [ChatFilterIncomingProvider],
  exports: [ChatFilterIncomingProvider],
})
class ChatFilterIncomingExtensionModule {}

export function createChatFilterIncomingExtension(): ForepathExtension<ChatFilter> {
  return {
    register(): DynamicModule {
      return {
        module: ChatFilterIncomingExtensionModule,
        providers: [ChatFilterIncomingProvider],
        exports: [ChatFilterIncomingProvider],
      };
    },
    getInstanceToken(): Type<ChatFilter> {
      return ChatFilterIncomingProvider;
    },
  };
}
