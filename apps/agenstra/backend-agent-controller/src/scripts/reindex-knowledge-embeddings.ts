import { KnowledgeEmbeddingIndexService } from '@forepath/agenstra/backend/feature-agent-controller';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app/app.module';

function readClientIdArg(args: string[]): string | undefined {
  const clientIdArg = args.find((arg) => arg.startsWith('--client-id='));

  if (clientIdArg) {
    return clientIdArg.split('=')[1];
  }

  const clientIdIdx = args.findIndex((arg) => arg === '--client-id');

  if (clientIdIdx >= 0 && args[clientIdIdx + 1]) {
    return args[clientIdIdx + 1];
  }

  return undefined;
}

async function main(): Promise<void> {
  const logger = new Logger('ReindexKnowledgeEmbeddingsCli');
  const args = process.argv.slice(2);
  const clientId = readClientIdArg(args);

  if (!clientId) {
    throw new Error('Missing required argument --client-id <uuid>');
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });

  try {
    const knowledgeEmbeddingIndexService = app.get(KnowledgeEmbeddingIndexService);
    const result = await knowledgeEmbeddingIndexService.reindexAllPages(clientId);

    logger.log(`Reindexed ${result.processed} page embeddings for client ${clientId}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const logger = new Logger('ReindexKnowledgeEmbeddingsCli');
  const message = error instanceof Error ? error.message : String(error);

  logger.error(`Embedding reindex failed: ${message}`);
  process.exit(1);
});
