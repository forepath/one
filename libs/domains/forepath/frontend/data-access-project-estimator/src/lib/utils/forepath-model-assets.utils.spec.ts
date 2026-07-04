import {
  FOREPATH_LOCAL_LLM_MODEL_CONFIG_FILE,
  isHtmlJsonParseError,
  isSelfHostedModelAvailable,
  toModelLoadErrorMessage,
} from './forepath-model-assets.utils';

describe('forepathModelAssetsUtils', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('should accept valid self-hosted model config responses', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: () => 'application/json',
      },
      text: async () => JSON.stringify({ model_type: 'llm' }),
    } as Response);

    await expect(isSelfHostedModelAvailable('https://forepath.test/assets/models/')).resolves.toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `https://forepath.test/assets/models/${FOREPATH_LOCAL_LLM_MODEL_CONFIG_FILE}`,
    );
  });

  it('should reject HTML responses from missing model assets', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: () => 'text/html',
      },
      text: async () => '<!DOCTYPE html><html></html>',
    } as Response);

    await expect(isSelfHostedModelAvailable('https://forepath.test/assets/models/')).resolves.toBe(false);
  });

  it('should map HTML JSON parse failures to a friendly message', () => {
    expect(isHtmlJsonParseError(new Error('Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON'))).toBe(true);
    expect(toModelLoadErrorMessage(new Error('Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON'))).toContain(
      'The quote tool could not be loaded',
    );
  });
});
