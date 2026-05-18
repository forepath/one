import { toolMayMutateGitWorkspace } from './agent-git-state.constants';

describe('toolMayMutateGitWorkspace', () => {
  it('returns true for workspace-mutating tool names', () => {
    expect(toolMayMutateGitWorkspace('write_file')).toBe(true);
    expect(toolMayMutateGitWorkspace('bash')).toBe(true);
    expect(toolMayMutateGitWorkspace('git-commit')).toBe(true);
  });

  it('returns false for read-only tool names', () => {
    expect(toolMayMutateGitWorkspace('read')).toBe(false);
    expect(toolMayMutateGitWorkspace('grep')).toBe(false);
  });
});
