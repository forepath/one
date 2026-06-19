import { DynamicModule, Module, Type } from '@nestjs/common';

import type { ChatFilter } from '@forepath/agenstra/backend/util-plugin-host';
import type { ForepathExtension } from '@forepath/shared/backend/util-extension-core';

import { ChatFilterOutgoingProvider } from './chat-filter-outgoing.provider';

@Module({
  providers: [ChatFilterOutgoingProvider],
  exports: [ChatFilterOutgoingProvider],
})
class ChatFilterOutgoingExtensionModule {}

export function createChatFilterOutgoingExtension(): ForepathExtension<ChatFilter> {
  return {
    register(): DynamicModule {
      return {
        module: ChatFilterOutgoingExtensionModule,
        providers: [ChatFilterOutgoingProvider],
        exports: [ChatFilterOutgoingProvider],
      };
    },
    getInstanceToken(): Type<ChatFilter> {
      return ChatFilterOutgoingProvider;
    },
  };
}
