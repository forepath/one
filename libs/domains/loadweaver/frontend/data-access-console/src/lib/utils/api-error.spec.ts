import { HttpErrorResponse } from '@angular/common/http';

import { apiErrorMessage, apiErrorMessageAsync } from './api-error';

describe('apiErrorMessage', () => {
  it('joins validation messages and attached details', () => {
    expect(apiErrorMessage(new HttpErrorResponse({ status: 400, error: { message: ['a', 'b'] } }), 'fallback')).toBe(
      'a; b',
    );
    expect(
      apiErrorMessage(
        new HttpErrorResponse({
          status: 400,
          error: { message: 'The plan cannot be applied', issues: [{ path: 'web', message: 'no node fits' }] },
        }),
        'fallback',
      ),
    ).toBe('The plan cannot be applied: web: no node fits');
  });

  it('parses JSON error bodies of text requests', () => {
    expect(
      apiErrorMessage(new HttpErrorResponse({ status: 400, error: '{"message":"Range too large"}' }), 'fallback'),
    ).toBe('Range too large');
    expect(apiErrorMessage(new HttpErrorResponse({ status: 502, error: '{broken' }), 'fallback')).toBe('{broken');
  });

  it('translates known server messages', () => {
    expect(
      apiErrorMessage(
        new HttpErrorResponse({
          status: 503,
          error: { message: 'no control-plane member can hold a master-key share yet' },
        }),
        'x',
      ),
    ).toBe(
      "The cluster master key isn't set up yet: no control-plane member can hold a share of it. Join a node, or turn on the built-in control-plane member (LOADWEAVER_BUILTIN_MEMBER).",
    );
  });

  it('falls back', () => {
    expect(apiErrorMessage(null, 'fallback')).toBe('fallback');
    expect(apiErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
  });
});

describe('apiErrorMessageAsync', () => {
  it('reads the server message from a JSON blob body', async () => {
    const error = new HttpErrorResponse({
      status: 404,
      error: new Blob([JSON.stringify({ message: 'No such file' })], { type: 'application/json' }),
    });

    await expect(apiErrorMessageAsync(error, 'Download failed')).resolves.toBe('No such file');
  });

  it('uses a plain-text blob body and falls back for empty ones', async () => {
    await expect(
      apiErrorMessageAsync(new HttpErrorResponse({ status: 500, error: new Blob(['upstream down']) }), 'x'),
    ).resolves.toBe('upstream down');
    await expect(
      apiErrorMessageAsync(
        new HttpErrorResponse({ status: 500, statusText: 'Error', url: '/a', error: new Blob([]) }),
        'x',
      ),
    ).resolves.toContain('/a');
    await expect(apiErrorMessageAsync(new Error('boom'), 'x')).resolves.toBe('boom');
  });
});
