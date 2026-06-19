import { DynamicModule, Module, Type } from '@nestjs/common';

import type { ChatFilter } from '@forepath/agenstra/backend/util-plugin-host';
import type { ForepathExtension } from '@forepath/shared/backend/util-extension-core';

import { ChatFilterDbRegexIncomingProvider } from './chat-filter-db-regex-incoming.provider';

@Module({
  providers: [ChatFilterDbRegexIncomingProvider],
  exports: [ChatFilterDbRegexIncomingProvider],
})
class ChatFilterDbRegexIncomingExtensionModule {}

export function createChatFilterDbRegexIncomingExtension(): ForepathExtension<ChatFilter> {
  return {
    register(): DynamicModule {
      return {
        module: ChatFilterDbRegexIncomingExtensionModule,
        providers: [ChatFilterDbRegexIncomingProvider],
        exports: [ChatFilterDbRegexIncomingProvider],
      };
    },
    getInstanceToken(): Type<ChatFilter> {
      return ChatFilterDbRegexIncomingProvider;
    },
  };
}
