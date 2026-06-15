import type { GitBranchDto } from '@forepath/agenstra/backend/feature-agent-manager';

import { listContainsBranchName } from './ticket-automation-branch.utils';

describe('ticket-automation-branch.utils', () => {
  it('listContainsBranchName matches short branch name', () => {
    const branches = [{ name: 'main' }, { name: 'automation/ticket-x' }] as GitBranchDto[];

    expect(listContainsBranchName(branches, 'automation/ticket-x')).toBe(true);
    expect(listContainsBranchName(branches, 'other')).toBe(false);
  });
});
