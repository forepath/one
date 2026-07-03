import {
  PROJECT_ESTIMATE_PROMPT_CHARS_PER_TOKEN,
  PROJECT_ESTIMATE_PROMPT_TEMPLATE_OVERHEAD_TOKENS,
} from '../constants/forepath-prompt-input.constants';

export interface FitUserPromptToContextWindowInput {
  userPrompt: string;
  contextWindowSize: number;
  systemPrompt: string;
  templateOverheadTokens?: number;
  charsPerToken?: number;
}

export interface ResolveMaxOutputTokensInput {
  contextWindowSize: number;
  systemPrompt: string;
  userPrompt: string;
  requestedMaxTokens: number;
  templateOverheadTokens?: number;
  charsPerToken?: number;
}

export const PROJECT_ESTIMATE_MIN_OUTPUT_TOKENS = 256;

export function estimatePromptTokenCount(
  text: string,
  charsPerToken = PROJECT_ESTIMATE_PROMPT_CHARS_PER_TOKEN,
): number {
  if (!text) {
    return 0;
  }

  return Math.ceil(text.length / charsPerToken);
}

export function computeMaxUserPromptTokens(input: FitUserPromptToContextWindowInput): number {
  const charsPerToken = input.charsPerToken ?? PROJECT_ESTIMATE_PROMPT_CHARS_PER_TOKEN;
  const templateOverheadTokens = input.templateOverheadTokens ?? PROJECT_ESTIMATE_PROMPT_TEMPLATE_OVERHEAD_TOKENS;
  const maxPrefillTokens = input.contextWindowSize - templateOverheadTokens;
  const systemTokens = estimatePromptTokenCount(input.systemPrompt, charsPerToken);

  return Math.max(0, maxPrefillTokens - systemTokens);
}

export function computeMaxOutputTokens(input: ResolveMaxOutputTokensInput): number {
  const charsPerToken = input.charsPerToken ?? PROJECT_ESTIMATE_PROMPT_CHARS_PER_TOKEN;
  const templateOverheadTokens = input.templateOverheadTokens ?? PROJECT_ESTIMATE_PROMPT_TEMPLATE_OVERHEAD_TOKENS;
  const promptTokens =
    estimatePromptTokenCount(input.systemPrompt, charsPerToken) +
    estimatePromptTokenCount(input.userPrompt, charsPerToken);
  const availableTokens = input.contextWindowSize - promptTokens - templateOverheadTokens;

  return Math.max(PROJECT_ESTIMATE_MIN_OUTPUT_TOKENS, Math.min(input.requestedMaxTokens, availableTokens));
}

export function truncatePromptToMaxTokens(
  text: string,
  maxTokens: number,
  charsPerToken = PROJECT_ESTIMATE_PROMPT_CHARS_PER_TOKEN,
): string {
  if (!text) {
    return text;
  }

  if (maxTokens <= 0) {
    return '';
  }

  if (estimatePromptTokenCount(text, charsPerToken) <= maxTokens) {
    return text;
  }

  let low = 0;
  let high = text.length;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = text.slice(0, mid);

    if (estimatePromptTokenCount(candidate, charsPerToken) <= maxTokens) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  let truncated = text.slice(0, low).trimEnd();
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > truncated.length * 0.7) {
    truncated = truncated.slice(0, lastSpace).trimEnd();
  }

  return truncated;
}

export function fitUserPromptToContextWindow(input: FitUserPromptToContextWindowInput): string {
  const trimmedPrompt = input.userPrompt.trim();

  if (!trimmedPrompt) {
    return trimmedPrompt;
  }

  const maxUserTokens = computeMaxUserPromptTokens(input);

  return truncatePromptToMaxTokens(
    trimmedPrompt,
    maxUserTokens,
    input.charsPerToken ?? PROJECT_ESTIMATE_PROMPT_CHARS_PER_TOKEN,
  );
}
