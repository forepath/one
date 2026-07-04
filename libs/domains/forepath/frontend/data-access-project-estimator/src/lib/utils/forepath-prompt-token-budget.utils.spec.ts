import {
  FOREPATH_ESTIMATE_CALCULATION_GUIDELINES,
  FOREPATH_ESTIMATE_CALCULATION_GUIDELINES_COMPACT,
  FOREPATH_ESTIMATE_JSON_SCHEMA_DESCRIPTION,
} from '../constants/forepath-estimate-guidelines.constants';
import {
  FOREPATH_LLM_MEMORY_PROFILE_BALANCED,
  FOREPATH_LLM_MEMORY_PROFILE_LITE,
} from '../constants/forepath-llm-memory.constants';
import { ForepathPricingCalculatorService } from '../services/forepath-pricing-calculator.service';

import {
  computeMaxOutputTokens,
  computeMaxUserPromptTokens,
  estimatePromptTokenCount,
  fitUserPromptToContextWindow,
  truncatePromptToMaxTokens,
} from './forepath-prompt-token-budget.utils';

function buildSystemPrompt(compact: boolean): string {
  const calculator = new ForepathPricingCalculatorService();
  const catalog = calculator.buildCatalogPromptContext(compact);
  const guidelines = compact
    ? FOREPATH_ESTIMATE_CALCULATION_GUIDELINES_COMPACT
    : FOREPATH_ESTIMATE_CALCULATION_GUIDELINES;

  return [
    'You are a ForePath project estimator.',
    'Convert the user project description into a structured JSON breakdown using only the available ForePath services.',
    'Be consistent: the same project description must always produce the same line items and billingUnits.',
    'Return ONLY valid JSON with this shape:',
    FOREPATH_ESTIMATE_JSON_SCHEMA_DESCRIPTION,
    guidelines,
    'Available services:',
    catalog,
  ].join('\n');
}

describe('forepath-prompt-token-budget.utils', () => {
  it('should estimate token counts from text length', () => {
    expect(estimatePromptTokenCount('')).toBe(0);
    expect(estimatePromptTokenCount('abcd')).toBe(2);
  });

  it('should leave text unchanged when within the token budget', () => {
    const text = 'Need a workshop for our team';

    expect(truncatePromptToMaxTokens(text, 20)).toBe(text);
  });

  it('should truncate text beyond the token budget', () => {
    const text = 'one two three four five six seven eight nine ten';

    expect(truncatePromptToMaxTokens(text, 4, 4)).toBe('one two three');
  });

  it('should reserve system tokens when computing the user budget', () => {
    const compactSystemPrompt = buildSystemPrompt(true);
    const maxUserTokens = computeMaxUserPromptTokens({
      contextWindowSize: FOREPATH_LLM_MEMORY_PROFILE_BALANCED.contextWindowSize,
      systemPrompt: compactSystemPrompt,
    });

    expect(maxUserTokens).toBeGreaterThan(100);

    const fittedPrompt = fitUserPromptToContextWindow({
      userPrompt: 'word '.repeat(5_000),
      contextWindowSize: FOREPATH_LLM_MEMORY_PROFILE_BALANCED.contextWindowSize,
      systemPrompt: compactSystemPrompt,
    });

    const totalPromptTokens = estimatePromptTokenCount(compactSystemPrompt) + estimatePromptTokenCount(fittedPrompt);

    expect(totalPromptTokens).toBeLessThanOrEqual(FOREPATH_LLM_MEMORY_PROFILE_BALANCED.contextWindowSize);
  });

  it('should cap output tokens to remaining context window space', () => {
    const compactSystemPrompt = buildSystemPrompt(true);
    const userPrompt = 'Need a complex multi-platform application with maps and admin tools.';

    const maxOutputTokens = computeMaxOutputTokens({
      contextWindowSize: FOREPATH_LLM_MEMORY_PROFILE_BALANCED.contextWindowSize,
      systemPrompt: compactSystemPrompt,
      userPrompt,
      requestedMaxTokens: FOREPATH_LLM_MEMORY_PROFILE_BALANCED.maxTokens,
    });

    expect(maxOutputTokens).toBeGreaterThan(0);
    expect(maxOutputTokens).toBeLessThanOrEqual(FOREPATH_LLM_MEMORY_PROFILE_BALANCED.maxTokens);
  });

  it('should leave room for user input on the lite profile', () => {
    const liteSystemPrompt = buildSystemPrompt(true);
    const maxUserTokens = computeMaxUserPromptTokens({
      contextWindowSize: FOREPATH_LLM_MEMORY_PROFILE_LITE.contextWindowSize,
      systemPrompt: liteSystemPrompt,
    });

    expect(maxUserTokens).toBeGreaterThan(100);
  });
});
