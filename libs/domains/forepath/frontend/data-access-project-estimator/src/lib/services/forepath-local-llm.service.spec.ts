import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import {
  FOREPATH_LLM_MEMORY_PROFILE_BALANCED,
  FOREPATH_LLM_MEMORY_PROFILE_LITE,
  FOREPATH_LOCAL_LLM_MODEL_ID_STANDARD,
} from '../constants/forepath-llm-memory.constants';
import {
  FOREPATH_ESTIMATE_LLM_TEMPERATURE,
  FOREPATH_ESTIMATE_LLM_TOP_P,
} from '../constants/forepath-estimate-llm.constants';
import { FOREPATH_PROJECT_BREAKDOWN_JSON_SCHEMA } from '../constants/forepath-project-breakdown.schema';
import { FOREPATH_LOCAL_LLM_WORKER_FACTORY } from '../tokens/forepath-local-llm-worker.token';
import { hashStringToSeed, normalizeProjectDescription } from '../utils/forepath-prompt-hash.utils';

import { ForepathEstimateParserService } from './forepath-estimate-parser.service';
import { ForepathLocalLlmService } from './forepath-local-llm.service';
import { ForepathLlmMemoryProfileService } from './forepath-llm-memory-profile.service';
import { ForepathPricingCalculatorService } from './forepath-pricing-calculator.service';

describe('ForepathLocalLlmService', () => {
  let service: ForepathLocalLlmService;
  let memoryProfileService: ForepathLlmMemoryProfileService;
  let parser: jest.Mocked<ForepathEstimateParserService>;
  let pricingCalculator: jest.Mocked<ForepathPricingCalculatorService>;
  let chatCreate: jest.Mock;
  let createEngineMock: jest.Mock;
  let unloadMock: jest.Mock;
  const originalFetch = globalThis.fetch;
  const originalPerformance = globalThis.performance;

  const prebuiltRecord = {
    model: 'https://example.test/original-model',
    model_id: FOREPATH_LOCAL_LLM_MODEL_ID_STANDARD,
    model_lib: 'https://example.test/model.wasm',
  };

  beforeEach(() => {
    parser = {
      parseModelOutput: jest.fn(),
    } as never;

    pricingCalculator = {
      buildCatalogPromptContext: jest.fn().mockReturnValue('[{"id":"software-development"}]'),
      calculateEstimate: jest.fn(),
    } as never;

    chatCreate = jest.fn();
    unloadMock = jest.fn().mockResolvedValue(undefined);

    createEngineMock = jest.fn().mockResolvedValue({
      chat: {
        completions: {
          create: chatCreate,
        },
      },
      unload: unloadMock,
    });

    TestBed.configureTestingModule({
      providers: [
        ForepathLocalLlmService,
        ForepathLlmMemoryProfileService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: FOREPATH_LOCAL_LLM_WORKER_FACTORY, useValue: () => ({ terminate: jest.fn() }) as Worker },
        { provide: ForepathEstimateParserService, useValue: parser },
        { provide: ForepathPricingCalculatorService, useValue: pricingCalculator },
      ],
    });

    service = TestBed.inject(ForepathLocalLlmService);
    memoryProfileService = TestBed.inject(ForepathLlmMemoryProfileService);
    memoryProfileService.setProfile(FOREPATH_LLM_MEMORY_PROFILE_BALANCED);

    (service as unknown as { engine: null; enginePromise: null; breakdownCache: Map<string, unknown> }).engine = null;
    (service as unknown as { engine: null; enginePromise: null; breakdownCache: Map<string, unknown> }).enginePromise =
      null;
    (service as unknown as { breakdownCache: Map<string, unknown> }).breakdownCache.clear();

    jest.spyOn(service as never as { loadWebLlmModule: () => Promise<unknown> }, 'loadWebLlmModule').mockResolvedValue({
      CreateWebWorkerMLCEngine: createEngineMock,
      prebuiltAppConfig: {
        model_list: [prebuiltRecord],
      },
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'performance', {
      configurable: true,
      value: originalPerformance,
    });
    jest.restoreAllMocks();
  });

  it('should prefer the full catalog for balanced profiles when it fits the context window', () => {
    memoryProfileService.setProfile(FOREPATH_LLM_MEMORY_PROFILE_BALANCED);
    service.buildSystemPrompt();

    expect(pricingCalculator.buildCatalogPromptContext).toHaveBeenCalledWith(false);
    expect(pricingCalculator.buildCatalogPromptContext).not.toHaveBeenCalledWith(true);
  });

  it('should fall back to compact system prompt when the full prompt exceeds the context window', () => {
    memoryProfileService.setProfile(FOREPATH_LLM_MEMORY_PROFILE_BALANCED);
    pricingCalculator.buildCatalogPromptContext.mockImplementation((compact = false) =>
      compact ? 'compact-catalog'.repeat(200) : 'full-catalog'.repeat(500),
    );

    const prompt = service.buildSystemPrompt();

    expect(pricingCalculator.buildCatalogPromptContext).toHaveBeenCalledWith(false);
    expect(pricingCalculator.buildCatalogPromptContext).toHaveBeenCalledWith(true);
    expect(prompt).toContain('compact-catalog');
  });

  it('should use compact catalog for lite profiles', () => {
    memoryProfileService.setProfile(FOREPATH_LLM_MEMORY_PROFILE_LITE);
    const litePrompt = service.buildSystemPrompt();

    expect(pricingCalculator.buildCatalogPromptContext).toHaveBeenCalledWith(true);
    expect(litePrompt).toContain('520 units');
    expect(litePrompt).toContain('Default to ZERO travel');
  });

  it('should truncate long user prompts to fit the active context window', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
    } as Response);

    const breakdown = {
      summary: 'Estimate',
      lineItems: [
        {
          serviceId: 'consulting' as const,
          description: 'Workshop',
          billingUnits: 4,
        },
      ],
      assumptions: [],
      confidence: 'medium' as const,
    };

    chatCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(breakdown) } }],
    });
    parser.parseModelOutput.mockReturnValue(breakdown);

    const longPrompt = 'scope '.repeat(5_000);
    await service.generateBreakdown(longPrompt);

    const createCall = chatCreate.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = createCall.messages.find((message) => message.role === 'user');

    expect(userMessage?.content.length).toBeLessThan(longPrompt.trim().length);
    expect(userMessage?.content.length).toBeGreaterThan(0);
  });

  it('should generate and parse a breakdown from the local engine', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
    } as Response);

    const breakdown = {
      summary: 'Estimate',
      lineItems: [
        {
          serviceId: 'consulting' as const,
          description: 'Workshop',
          billingUnits: 4,
        },
      ],
      assumptions: [],
      confidence: 'medium' as const,
    };

    chatCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(breakdown) } }],
    });
    parser.parseModelOutput.mockReturnValue(breakdown);

    const result = await service.generateBreakdown('Need a workshop');

    expect(result.lineItems[0]?.serviceId).toBe('consulting');
    expect(result.lineItems[0]?.billingUnits).toBe(160);
    expect(chatCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user', content: 'Need a workshop' }),
        ]),
        temperature: FOREPATH_ESTIMATE_LLM_TEMPERATURE,
        top_p: FOREPATH_ESTIMATE_LLM_TOP_P,
        seed: hashStringToSeed(normalizeProjectDescription('Need a workshop')),
        max_tokens: expect.any(Number),
        response_format: {
          type: 'json_object',
          schema: FOREPATH_PROJECT_BREAKDOWN_JSON_SCHEMA,
        },
      }),
    );
  });

  it('should reuse cached breakdowns for the same normalized prompt', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
    } as Response);

    const breakdown = {
      summary: 'Estimate',
      lineItems: [
        {
          serviceId: 'consulting' as const,
          description: 'Workshop',
          billingUnits: 4,
        },
      ],
      assumptions: [],
      confidence: 'medium' as const,
    };

    chatCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(breakdown) } }],
    });
    parser.parseModelOutput.mockReturnValue(breakdown);

    await service.generateBreakdown('Need a workshop');
    await service.generateBreakdown('  need   a workshop ');

    expect(chatCreate).toHaveBeenCalledTimes(1);
  });

  it('should pass reduced context window settings to the worker engine', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
    } as Response);

    await service.preload();

    expect(createEngineMock).toHaveBeenCalledWith(
      expect.objectContaining({ terminate: expect.any(Function) }),
      FOREPATH_LLM_MEMORY_PROFILE_BALANCED.modelId,
      expect.objectContaining({
        appConfig: {
          model_list: [prebuiltRecord],
        },
      }),
      {
        context_window_size: FOREPATH_LLM_MEMORY_PROFILE_BALANCED.contextWindowSize,
      },
    );
  });

  it('should use same-origin weights when model assets are available', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: () => 'application/json',
      },
      text: async () => JSON.stringify({ model_type: 'llm' }),
    } as Response);

    await service.preload();

    expect(createEngineMock).toHaveBeenCalledWith(
      expect.objectContaining({ terminate: expect.any(Function) }),
      FOREPATH_LLM_MEMORY_PROFILE_BALANCED.modelId,
      expect.objectContaining({
        appConfig: {
          model_list: [
            expect.objectContaining({
              model_id: FOREPATH_LLM_MEMORY_PROFILE_BALANCED.modelId,
              model: expect.stringContaining('/assets/models/qwen2.5-1.5b-instruct/'),
            }),
          ],
        },
      }),
      expect.any(Object),
    );
  });

  it('should reject generation when browser heap usage is too high', async () => {
    Object.defineProperty(globalThis, 'performance', {
      configurable: true,
      value: {
        memory: {
          usedJSHeapSize: 900,
          jsHeapSizeLimit: 1000,
        },
      },
    });

    await expect(service.generateBreakdown('Need a workshop')).rejects.toThrow('low on memory');
    expect(chatCreate).not.toHaveBeenCalled();
  });

  it('should unload the engine and clear cached breakdowns', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
    } as Response);

    await service.preload();
    await service.unload();

    expect(unloadMock).toHaveBeenCalled();
  });
});
