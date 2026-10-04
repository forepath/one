import {
  filterBuiltinProvidersByAllowDeny,
  formatProviderModelRef,
  getBuiltinProvider,
  isModelRefAllowed,
  isProviderAllowed,
  parseProviderModelRef,
  providersForKnownModelPicker,
  unusedBuiltinModelProviders,
  unusedBuiltinModelsForProvider,
  unusedBuiltinProviders,
} from './providers';
import type { OpencodeBuiltinProvider } from './types';

const SAMPLE: readonly OpencodeBuiltinProvider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    env: ['ANTHROPIC_API_KEY'],
    models: [
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5' },
    ],
  },
  { id: 'google', name: 'Google', env: ['GOOGLE_GENERATIVE_AI_API_KEY'], models: [] },
  {
    id: 'openai',
    name: 'OpenAI',
    env: ['OPENAI_API_KEY'],
    models: [{ id: 'gpt-4o', name: 'GPT-4o' }],
  },
];

describe('util-opencode-providers', () => {
  it('getBuiltinProvider_returnsMatchFromCatalog', () => {
    expect(getBuiltinProvider(SAMPLE, 'anthropic')).toEqual(
      expect.objectContaining({
        id: 'anthropic',
        name: 'Anthropic',
        env: expect.arrayContaining(['ANTHROPIC_API_KEY']),
      }),
    );
  });

  it('getBuiltinProvider_returnsUndefinedForUnknown', () => {
    expect(getBuiltinProvider(SAMPLE, 'not-a-real-provider')).toBeUndefined();
    expect(getBuiltinProvider(SAMPLE, '')).toBeUndefined();
  });

  it('unusedBuiltinProviders_filtersExistingKeys', () => {
    const unused = unusedBuiltinProviders(SAMPLE, ['anthropic', ' openai ', '']);

    expect(unused.find((provider) => provider.id === 'anthropic')).toBeUndefined();
    expect(unused.find((provider) => provider.id === 'openai')).toBeUndefined();
    expect(unused.find((provider) => provider.id === 'google')).toBeDefined();
  });

  it('unusedBuiltinModelProviders_includesAllCatalogProvidersWithRemainingModels', () => {
    const unused = unusedBuiltinModelProviders(SAMPLE, ['anthropic/claude-haiku-4-5']);

    expect(unused.find((provider) => provider.id === 'anthropic')).toBeDefined();
    expect(unused.find((provider) => provider.id === 'openai')).toBeDefined();
    expect(unused.find((provider) => provider.id === 'google')).toBeUndefined();
  });

  it('unusedBuiltinModelsForProvider_filtersExistingRefs', () => {
    const unused = unusedBuiltinModelsForProvider(SAMPLE, 'anthropic', ['anthropic/claude-haiku-4-5', 'openai/gpt-4o']);

    expect(unused.map((model) => model.id)).toEqual(['claude-opus-4-5']);
    expect(formatProviderModelRef('anthropic', 'claude-opus-4-5')).toBe('anthropic/claude-opus-4-5');
  });

  it('parseProviderModelRef_splitsProviderAndModel', () => {
    expect(parseProviderModelRef('anthropic/claude-opus-4-5')).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-opus-4-5',
    });
    expect(parseProviderModelRef('openai/org/custom')).toEqual({
      providerId: 'openai',
      modelId: 'org/custom',
    });
    expect(parseProviderModelRef('')).toBeNull();
    expect(parseProviderModelRef('noshift')).toBeNull();
    expect(parseProviderModelRef('/model')).toBeNull();
    expect(parseProviderModelRef('provider/')).toBeNull();
  });

  it('filterBuiltinProvidersByAllowDeny_keepsAllWhenListsEmpty', () => {
    expect(filterBuiltinProvidersByAllowDeny(SAMPLE, [], []).map((provider) => provider.id)).toEqual([
      'anthropic',
      'google',
      'openai',
    ]);
  });

  it('filterBuiltinProvidersByAllowDeny_appliesAllowAndDeny', () => {
    expect(
      filterBuiltinProvidersByAllowDeny(SAMPLE, ['anthropic', 'openai'], ['openai']).map((provider) => provider.id),
    ).toEqual(['anthropic']);
  });

  it('isProviderAllowed_denyWinsAndEmptyAllowIsUnrestricted', () => {
    expect(isProviderAllowed('openai', [], [])).toBe(true);
    expect(isProviderAllowed('openai', ['anthropic'], [])).toBe(false);
    expect(isProviderAllowed('openai', ['openai'], ['openai'])).toBe(false);
  });

  it('isModelRefAllowed_appliesProviderAndModelLists', () => {
    expect(isModelRefAllowed('openai/gpt-4o', [], [], [], [])).toBe(true);
    expect(isModelRefAllowed('openai/gpt-4o', ['anthropic'], [], [], [])).toBe(false);
    expect(isModelRefAllowed('openai/gpt-4o', [], [], ['openai/gpt-4o'], ['openai/gpt-4o'])).toBe(false);
    expect(isModelRefAllowed('openai/gpt-4o', [], [], ['anthropic/claude'], [])).toBe(false);
  });

  it('providersForKnownModelPicker_returnsFullCatalogWhenListsEmptyAndNoModelMetadata', () => {
    const withoutModels = SAMPLE.map((provider) => ({ ...provider, models: [] }));

    expect(providersForKnownModelPicker(withoutModels, [], [], []).map((provider) => provider.id)).toEqual([
      'anthropic',
      'google',
      'openai',
    ]);
  });

  it('providersForKnownModelPicker_usesCatalogModelsWhenPresent', () => {
    expect(
      providersForKnownModelPicker(SAMPLE, [], [], ['anthropic/claude-haiku-4-5']).map((provider) => provider.id),
    ).toEqual(['anthropic', 'openai']);
  });
});
