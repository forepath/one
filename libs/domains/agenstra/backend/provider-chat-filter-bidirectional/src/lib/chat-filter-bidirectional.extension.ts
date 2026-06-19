import { DynamicModule, Module, Type } from '@nestjs/common';

import type { ChatFilter } from '@forepath/agenstra/backend/util-plugin-host';
import type { ForepathExtension } from '@forepath/shared/backend/util-extension-core';

import { ChatFilterBidirectionalProvider } from './chat-filter-bidirectional.provider';

@Module({
  providers: [ChatFilterBidirectionalProvider],
  exports: [ChatFilterBidirectionalProvider],
})
class ChatFilterBidirectionalExtensionModule {}

export function createChatFilterBidirectionalExtension(): ForepathExtension<ChatFilter> {
  return {
    register(): DynamicModule {
      return {
        module: ChatFilterBidirectionalExtensionModule,
        providers: [ChatFilterBidirectionalProvider],
        exports: [ChatFilterBidirectionalProvider],
      };
    },
    getInstanceToken(): Type<ChatFilter> {
      return ChatFilterBidirectionalProvider;
    },
  };
}
