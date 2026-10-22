import { resolvePlainTextUserData } from './user-data.utils';

describe('resolvePlainTextUserData', () => {
  it('keeps plain scripts and cloud-config as they are', () => {
    expect(resolvePlainTextUserData('#!/bin/bash\necho hi')).toBe('#!/bin/bash\necho hi');
    expect(resolvePlainTextUserData('#cloud-config\nruncmd: []')).toBe('#cloud-config\nruncmd: []');
  });

  it('decodes base64-encoded scripts', () => {
    expect(resolvePlainTextUserData(Buffer.from('#!/bin/bash\necho hi').toString('base64'))).toBe(
      '#!/bin/bash\necho hi',
    );
  });

  it('returns other values unchanged', () => {
    expect(resolvePlainTextUserData('')).toBe('');
    expect(resolvePlainTextUserData('not a script')).toBe('not a script');
  });
});
