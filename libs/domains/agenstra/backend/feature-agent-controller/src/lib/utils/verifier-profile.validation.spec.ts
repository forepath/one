import { BadRequestException } from '@nestjs/common';

import { parseAndValidateVerifierProfile } from './verifier-profile.validation';

describe('parseAndValidateVerifierProfile', () => {
  const originalAllowlist = process.env.AUTOMATION_VERIFY_CMD_PREFIX_ALLOWLIST;

  afterEach(() => {
    if (originalAllowlist === undefined) {
      delete process.env.AUTOMATION_VERIFY_CMD_PREFIX_ALLOWLIST;
    } else {
      process.env.AUTOMATION_VERIFY_CMD_PREFIX_ALLOWLIST = originalAllowlist;
    }
  });

  it('returns empty commands for null', () => {
    expect(parseAndValidateVerifierProfile(null)).toEqual({ commands: [] });
  });

  it('accepts valid commands', () => {
    expect(
      parseAndValidateVerifierProfile({
        commands: [{ cmd: 'npm test' }, { cmd: 'npm run lint', cwd: 'repository' }],
      }),
    ).toEqual({
      commands: [{ cmd: 'npm test' }, { cmd: 'npm run lint', cwd: 'repository' }],
    });
  });

  it('rejects newlines in cmd', () => {
    expect(() =>
      parseAndValidateVerifierProfile({
        commands: [{ cmd: 'evil\nrm' }],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects verifierProfile that is not a plain object', () => {
    expect(() => parseAndValidateVerifierProfile([])).toThrow(BadRequestException);
    expect(() => parseAndValidateVerifierProfile('x')).toThrow(BadRequestException);
  });

  it('rejects when commands is not an array', () => {
    expect(() => parseAndValidateVerifierProfile({ commands: 'npm test' } as unknown as object)).toThrow(
      BadRequestException,
    );
  });

  it('rejects more than 32 commands', () => {
    const commands = Array.from({ length: 33 }, (_, i) => ({ cmd: `echo ${i}` }));

    expect(() => parseAndValidateVerifierProfile({ commands })).toThrow(BadRequestException);
  });

  it('rejects cmd longer than 2048 characters', () => {
    const cmd = `echo ${'x'.repeat(2048)}`;

    expect(() => parseAndValidateVerifierProfile({ commands: [{ cmd }] })).toThrow(BadRequestException);
  });

  it('rejects newlines in cwd', () => {
    expect(() =>
      parseAndValidateVerifierProfile({
        commands: [{ cmd: 'npm test', cwd: 'repo\n../../' }],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects non-object command entries', () => {
    expect(() =>
      parseAndValidateVerifierProfile({
        commands: ['npm test' as unknown as object],
      }),
    ).toThrow(BadRequestException);
  });

  it('enforces prefix allowlist when AUTOMATION_VERIFY_CMD_PREFIX_ALLOWLIST is set', () => {
    process.env.AUTOMATION_VERIFY_CMD_PREFIX_ALLOWLIST = 'npm,';

    expect(parseAndValidateVerifierProfile({ commands: [{ cmd: 'npm test' }] })).toEqual({
      commands: [{ cmd: 'npm test' }],
    });

    expect(() => parseAndValidateVerifierProfile({ commands: [{ cmd: 'yarn test' }] })).toThrow(BadRequestException);
  });
});
