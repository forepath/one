import { DynamicModule, Module, Type } from '@nestjs/common';

import type { ChatFilter } from '@forepath/agenstra/backend/util-plugin-host';
import type { ForepathExtension } from '@forepath/shared/backend/util-extension-core';

import { ChatFilterDbRegexOutgoingProvider } from './chat-filter-db-regex-outgoing.provider';

@Module({
  providers: [ChatFilterDbRegexOutgoingProvider],
  exports: [ChatFilterDbRegexOutgoingProvider],
})
class ChatFilterDbRegexOutgoingExtensionModule {}

export function createChatFilterDbRegexOutgoingExtension(): ForepathExtension<ChatFilter> {
  return {
    register(): DynamicModule {
      return {
        module: ChatFilterDbRegexOutgoingExtensionModule,
        providers: [ChatFilterDbRegexOutgoingProvider],
        exports: [ChatFilterDbRegexOutgoingProvider],
      };
    },
    getInstanceToken(): Type<ChatFilter> {
      return ChatFilterDbRegexOutgoingProvider;
    },
  };
}
