import { BadRequestException } from '@nestjs/common';

import { parseAgentFileManagerContext } from './agent-file-manager-context';

describe('parseAgentFileManagerContext', () => {
  it('defaults to app when undefined or empty', () => {
    expect(parseAgentFileManagerContext(undefined)).toBe('app');
    expect(parseAgentFileManagerContext('')).toBe('app');
    expect(parseAgentFileManagerContext('   ')).toBe('app');
  });

  it('accepts app and config', () => {
    expect(parseAgentFileManagerContext('app')).toBe('app');
    expect(parseAgentFileManagerContext('config')).toBe('config');
  });

  it('trims whitespace', () => {
    expect(parseAgentFileManagerContext('  config  ')).toBe('config');
  });

  it('rejects invalid values', () => {
    expect(() => parseAgentFileManagerContext('workspace')).toThrow(BadRequestException);
  });
});
