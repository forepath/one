import { LocalEmbeddingProvider } from './local-embedding.provider';

describe('LocalEmbeddingProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.EMBEDDING_DIMENSIONS;
    delete process.env.EMBEDDING_MODEL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns configured model name or default', () => {
    delete process.env.EMBEDDING_MODEL;
    const provider = new LocalEmbeddingProvider();

    expect(provider.getModelName()).toBe('local-hash-embed-v1');

    process.env.EMBEDDING_MODEL = 'custom-model';
    const provider2 = new LocalEmbeddingProvider();

    expect(provider2.getModelName()).toBe('custom-model');
  });

  it('reports local provider name', () => {
    const provider = new LocalEmbeddingProvider();

    expect(provider.getProviderName()).toBe('local');
  });

  it('embedMany returns one normalized vector per text with default dimensions', async () => {
    const provider = new LocalEmbeddingProvider();
    const results = await provider.embedMany(['Hello', 'World']);

    expect(results).toHaveLength(2);
    expect(results[0].vector.length).toBe(768);
    expect(results[1].vector.length).toBe(768);
    const norm0 = Math.sqrt(results[0].vector.reduce((s, v) => s + v * v, 0));

    expect(norm0).toBeCloseTo(1, 5);
  });

  it('uses EMBEDDING_DIMENSIONS when valid', async () => {
    process.env.EMBEDDING_DIMENSIONS = '16';
    const provider = new LocalEmbeddingProvider();
    const results = await provider.embedMany(['x']);

    expect(results[0].vector.length).toBe(16);
  });

  it('falls back to 768 when EMBEDDING_DIMENSIONS is invalid', async () => {
    process.env.EMBEDDING_DIMENSIONS = 'not-a-number';
    const provider = new LocalEmbeddingProvider();
    const results = await provider.embedMany(['y']);

    expect(results[0].vector.length).toBe(768);
  });

  it('embedMany handles empty string producing zero norm vector unchanged', async () => {
    process.env.EMBEDDING_DIMENSIONS = '4';
    const provider = new LocalEmbeddingProvider();
    const results = await provider.embedMany(['']);

    expect(results[0].vector).toEqual([0, 0, 0, 0]);
  });
});
