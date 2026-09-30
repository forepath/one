import { BadRequestException } from '@nestjs/common';

import { parseAgentFileManagerContext } from './agent-file-manager-context';

describe('parseAgentFileManagerContext', () => {
  it('defaults omitted or blank values to app', () => {
    expect(parseAgentFileManagerContext(undefined)).toBe('app');
    expect(parseAgentFileManagerContext('')).toBe('app');
    expect(parseAgentFileManagerContext('   ')).toBe('app');
  });

  it('accepts app', () => {
    expect(parseAgentFileManagerContext('app')).toBe('app');
  });

  it('rejects legacy config and unknown values', () => {
    expect(() => parseAgentFileManagerContext('config')).toThrow(BadRequestException);
    expect(() => parseAgentFileManagerContext('workspace')).toThrow(BadRequestException);
  });
});
