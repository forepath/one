import { BadRequestException } from '@nestjs/common';

import { assertNoCredentialKeysInConfig } from './opencode-config-credentials.utils';

describe('assertNoCredentialKeysInConfig', () => {
  it('allows non-credential config keys', () => {
    expect(() =>
      assertNoCredentialKeysInConfig({
        model: 'gpt-4',
        provider: { id: 'openai' },
      }),
    ).not.toThrow();
  });

  it('rejects credential-like top-level keys', () => {
    expect(() => assertNoCredentialKeysInConfig({ openai_api_key: 'sk-test' })).toThrow(BadRequestException);
  });

  it('rejects nested credential-like keys', () => {
    expect(() =>
      assertNoCredentialKeysInConfig({
        provider: { access_token: 'secret' },
      }),
    ).toThrow(/Credential-like key 'provider.access_token'/);
  });

  it('rejects credential-like keys inside arrays', () => {
    expect(() =>
      assertNoCredentialKeysInConfig({
        providers: [{ api_key: 'sk-test' }],
      }),
    ).toThrow(/Credential-like key 'providers\[0\]\.api_key'/);
  });

  it('allows null/undefined config', () => {
    expect(() => assertNoCredentialKeysInConfig(undefined)).not.toThrow();
    expect(() => assertNoCredentialKeysInConfig(null)).not.toThrow();
  });
});
