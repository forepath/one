import {
  isDraftLockActive,
  isRowVisible,
  isTabLockedByParent,
  isTabVisible,
  sectionVisible,
} from './lock-visibility.util';

describe('lock-visibility.util', () => {
  it('treats tab draft locks as covering owned field pointers', () => {
    expect(isDraftLockActive(['/tabs/general'], '/model')).toBe(true);
    expect(isDraftLockActive(['/tabs/general'], '/providers')).toBe(false);
    expect(isDraftLockActive(['/model'], '/model')).toBe(true);
  });

  it('detects parent tab locks via /tabs/{id} or root path', () => {
    expect(isTabLockedByParent(['/tabs/mcp', '/mcp'], 'mcp')).toBe(true);
    expect(isTabLockedByParent(['/mcp'], 'mcp')).toBe(true);
    expect(isTabLockedByParent(['/mcp/timeout'], 'mcp')).toBe(false);
  });

  it('keeps locked fields and tabs visible for read-only presentation', () => {
    const locked = ['/tabs/mcp', '/mcp', '/mcp/servers', '/model', '/tabs/warming', '/warming'];

    expect(isTabVisible('agent', locked, 'mcp')).toBe(true);
    expect(isTabVisible('agent', locked, 'warming')).toBe(true);
    expect(isTabVisible('workspace', locked, 'mcp')).toBe(true);
    expect(isRowVisible(locked, '/mcp/timeout')).toBe(true);
    expect(isRowVisible(locked, '/mcp/servers')).toBe(true);
    expect(isRowVisible(locked, '/model')).toBe(true);
    expect(sectionVisible(locked, '/model')).toBe(true);
    expect(sectionVisible(locked, '/model', '/shell')).toBe(true);
  });
});
