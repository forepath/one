/** Token / cost usage reported by an agent turn (`usage` on the response or on one of its `parts`). */
export type ChatOutputUsage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
};

export function extractChatOutputUsage(response: unknown): ChatOutputUsage | undefined {
  if (!response || typeof response !== 'object') {
    return undefined;
  }

  const root = response as Record<string, unknown>;
  const candidates: unknown[] = [root.usage];

  if (Array.isArray(root.parts)) {
    for (const part of root.parts) {
      if (part && typeof part === 'object' && 'usage' in (part as object)) {
        candidates.push((part as { usage?: unknown }).usage);
      }
    }
  }

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const usage = candidate as Record<string, unknown>;
    const result: ChatOutputUsage = {
      ...(typeof usage.inputTokens === 'number' ? { inputTokens: usage.inputTokens } : {}),
      ...(typeof usage.outputTokens === 'number' ? { outputTokens: usage.outputTokens } : {}),
      ...(typeof usage.reasoningTokens === 'number' ? { reasoningTokens: usage.reasoningTokens } : {}),
      ...(typeof usage.cacheReadTokens === 'number' ? { cacheReadTokens: usage.cacheReadTokens } : {}),
      ...(typeof usage.cacheWriteTokens === 'number' ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
      ...(typeof usage.costUsd === 'number' ? { costUsd: usage.costUsd } : {}),
    };

    if (Object.keys(result).length > 0) {
      return result;
    }
  }

  return undefined;
}
