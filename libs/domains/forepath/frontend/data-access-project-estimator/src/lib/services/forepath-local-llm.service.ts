import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';

import {
  FOREPATH_ESTIMATE_LLM_TEMPERATURE,
  FOREPATH_ESTIMATE_LLM_TOP_P,
} from '../constants/forepath-estimate-llm.constants';
import {
  FOREPATH_ESTIMATE_CALCULATION_GUIDELINES,
  FOREPATH_ESTIMATE_CALCULATION_GUIDELINES_COMPACT,
  FOREPATH_ESTIMATE_JSON_SCHEMA_DESCRIPTION,
} from '../constants/forepath-estimate-guidelines.constants';
import { FOREPATH_PROJECT_BREAKDOWN_JSON_SCHEMA } from '../constants/forepath-project-breakdown.schema';
import {
  FOREPATH_LOCAL_LLM_MODEL_BASE_URL,
  FOREPATH_LOCAL_LLM_MODEL_ID_STANDARD,
} from '../constants/forepath-service-catalog.constants';
import type { ProjectBreakdown } from '../types/project-estimator.types';
import { FOREPATH_LOCAL_LLM_WORKER_FACTORY } from '../tokens/forepath-local-llm-worker.token';
import { cloneProjectBreakdown } from '../utils/forepath-breakdown-clone.utils';
import { calibrateProjectBreakdown } from '../utils/forepath-breakdown-calibration.utils';
import { isSelfHostedModelAvailable, toModelLoadErrorMessage } from '../utils/forepath-model-assets.utils';
import { hashStringToSeed, normalizeProjectDescription } from '../utils/forepath-prompt-hash.utils';

import { ForepathEstimateParserService } from './forepath-estimate-parser.service';
import { ForepathLlmMemoryProfileService } from './forepath-llm-memory-profile.service';
import { ForepathPricingCalculatorService } from './forepath-pricing-calculator.service';

type WebLlmModule = typeof import('@mlc-ai/web-llm');
type ChatCompletionMessageParam = import('@mlc-ai/web-llm').ChatCompletionMessageParam;
type ChatOptions = import('@mlc-ai/web-llm').ChatOptions;
type MlcEngine = import('@mlc-ai/web-llm').MLCEngineInterface;
type JsonObjectResponseFormat = {
  type: 'json_object';
  schema: string;
};

export interface LocalLlmProgress {
  progress: number;
  text: string;
}

@Injectable()
export class ForepathLocalLlmService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly parser = inject(ForepathEstimateParserService);
  private readonly pricingCalculator = inject(ForepathPricingCalculatorService);
  private readonly memoryProfileService = inject(ForepathLlmMemoryProfileService);
  private readonly createWorker = inject(FOREPATH_LOCAL_LLM_WORKER_FACTORY);

  private engine: MlcEngine | null = null;
  private enginePromise: Promise<MlcEngine> | null = null;
  private llmWorker: Worker | null = null;
  private webLlmModule: WebLlmModule | null = null;
  private readonly breakdownCache = new Map<string, ProjectBreakdown>();

  private readonly jsonResponseFormat: JsonObjectResponseFormat = {
    type: 'json_object',
    schema: FOREPATH_PROJECT_BREAKDOWN_JSON_SCHEMA,
  };

  async preload(onProgress?: (progress: LocalLlmProgress) => void): Promise<void> {
    await this.ensureEngine(onProgress);
  }

  async generateBreakdown(
    userPrompt: string,
    onProgress?: (progress: LocalLlmProgress) => void,
  ): Promise<ProjectBreakdown> {
    this.memoryProfileService.assertMemoryHeadroom();

    const normalizedPrompt = normalizeProjectDescription(userPrompt);
    const profileId = this.memoryProfileService.getProfile().profileId;
    const cacheKey = `${profileId}:${normalizedPrompt}`;
    const cachedBreakdown = this.breakdownCache.get(cacheKey);

    if (cachedBreakdown) {
      return cloneProjectBreakdown(cachedBreakdown);
    }

    const engine = await this.ensureEngine(onProgress);
    const messages = this.buildMessages(userPrompt);
    const completionParams = this.buildCompletionParams(messages, normalizedPrompt);
    const response = await engine.chat.completions.create(completionParams);

    const content = response.choices[0]?.message?.content;

    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new Error('Local model returned an empty response.');
    }

    try {
      const breakdown = calibrateProjectBreakdown(this.parser.parseModelOutput(content), normalizedPrompt);
      this.breakdownCache.set(cacheKey, breakdown);

      return cloneProjectBreakdown(breakdown);
    } catch (initialError) {
      this.memoryProfileService.assertMemoryHeadroom();

      const retryMessages: ChatCompletionMessageParam[] = [
        ...messages,
        { role: 'assistant', content },
        {
          role: 'user',
          content:
            'Your previous answer was invalid. Respond with only valid JSON matching the requested schema. Do not include markdown fences or commentary.',
        },
      ];

      const retryResponse = await engine.chat.completions.create({
        ...this.buildCompletionParams(retryMessages, normalizedPrompt),
      });

      const retryContent = retryResponse.choices[0]?.message?.content;

      if (typeof retryContent !== 'string' || retryContent.trim().length === 0) {
        throw initialError instanceof Error ? initialError : new Error('Failed to parse model output.');
      }

      const breakdown = calibrateProjectBreakdown(this.parser.parseModelOutput(retryContent), normalizedPrompt);
      this.breakdownCache.set(cacheKey, breakdown);

      return cloneProjectBreakdown(breakdown);
    }
  }

  buildSystemPrompt(): string {
    const profile = this.memoryProfileService.getProfile();
    const catalog = this.pricingCalculator.buildCatalogPromptContext(profile.useCompactPrompt);
    const guidelines = profile.useCompactPrompt
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

  async unload(): Promise<void> {
    if (this.engine) {
      try {
        await this.engine.unload();
      } catch {
        // Best-effort cleanup after OOM or device loss.
      }
    }

    this.llmWorker?.terminate();
    this.engine = null;
    this.enginePromise = null;
    this.llmWorker = null;
    this.breakdownCache.clear();
  }

  private buildCompletionParams(
    messages: ChatCompletionMessageParam[],
    normalizedPrompt: string,
  ): {
    messages: ChatCompletionMessageParam[];
    temperature: number;
    top_p: number;
    seed: number;
    max_tokens: number;
    response_format: JsonObjectResponseFormat;
  } {
    const profile = this.memoryProfileService.getProfile();

    return {
      messages,
      temperature: FOREPATH_ESTIMATE_LLM_TEMPERATURE,
      top_p: FOREPATH_ESTIMATE_LLM_TOP_P,
      seed: hashStringToSeed(normalizedPrompt),
      max_tokens: profile.maxTokens,
      response_format: this.jsonResponseFormat,
    };
  }

  private buildChatOptions(): ChatOptions {
    const profile = this.memoryProfileService.getProfile();

    return {
      context_window_size: profile.contextWindowSize,
    };
  }

  private buildMessages(userPrompt: string): ChatCompletionMessageParam[] {
    return [
      { role: 'system', content: this.buildSystemPrompt() },
      { role: 'user', content: userPrompt.trim() },
    ];
  }

  private async ensureEngine(onProgress?: (progress: LocalLlmProgress) => void): Promise<MlcEngine> {
    if (!isPlatformBrowser(this.platformId)) {
      throw new Error('Local model can only run in the browser.');
    }

    this.memoryProfileService.assertMemoryHeadroom();

    if (this.engine) {
      return this.engine;
    }

    if (!this.enginePromise) {
      this.enginePromise = this.createEngine(onProgress);
    }

    this.engine = await this.enginePromise;

    return this.engine;
  }

  private async createEngine(onProgress?: (progress: LocalLlmProgress) => void): Promise<MlcEngine> {
    const webLlm = await this.loadWebLlmModule();
    const profile = this.memoryProfileService.getProfile();

    try {
      const modelRecord = await this.resolveModelRecord(webLlm, profile.modelId);
      this.llmWorker = this.createWorker();

      const engine = await webLlm.CreateWebWorkerMLCEngine(
        this.llmWorker,
        profile.modelId,
        {
          appConfig: {
            model_list: [modelRecord],
          },
          initProgressCallback: (report) => {
            onProgress?.({
              progress: report.progress,
              text: report.text,
            });
          },
        },
        this.buildChatOptions(),
      );

      return engine;
    } catch (error) {
      this.llmWorker?.terminate();
      this.llmWorker = null;
      throw new Error(toModelLoadErrorMessage(error));
    }
  }

  private async loadWebLlmModule(): Promise<WebLlmModule> {
    if (!this.webLlmModule) {
      this.webLlmModule = await import('@mlc-ai/web-llm');
    }

    return this.webLlmModule;
  }

  private async resolveModelRecord(
    webLlm: WebLlmModule,
    modelId: string,
  ): Promise<import('@mlc-ai/web-llm').ModelRecord> {
    const prebuiltRecord = webLlm.prebuiltAppConfig.model_list.find((record) => record.model_id === modelId);

    if (!prebuiltRecord) {
      throw new Error(`Unsupported local model: ${modelId}`);
    }

    const selfHostedBaseUrl = this.getSelfHostedModelBaseUrl(modelId);

    if (!selfHostedBaseUrl) {
      return prebuiltRecord;
    }

    const selfHostedModelUrl = this.getSelfHostedModelUrl(selfHostedBaseUrl);
    const selfHostedAvailable = await isSelfHostedModelAvailable(selfHostedModelUrl);

    if (selfHostedAvailable) {
      return {
        ...prebuiltRecord,
        model: selfHostedModelUrl,
      };
    }

    return prebuiltRecord;
  }

  private getSelfHostedModelBaseUrl(modelId: string): string | null {
    if (modelId === FOREPATH_LOCAL_LLM_MODEL_ID_STANDARD) {
      return FOREPATH_LOCAL_LLM_MODEL_BASE_URL;
    }

    return null;
  }

  private getSelfHostedModelUrl(baseUrl: string): string {
    const normalizedBase = baseUrl.replace(/\/$/, '');

    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}${normalizedBase}/`;
    }

    return `${normalizedBase}/`;
  }
}
