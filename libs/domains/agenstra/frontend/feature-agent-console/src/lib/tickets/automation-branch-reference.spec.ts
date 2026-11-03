import type { GitBranch } from '@forepath/agenstra/frontend/data-access-agent-console';
import { of } from 'rxjs';

import { automationBranchEnvironmentId, automationBranchLoader } from './automation-branch-reference';

function branch(name: string, isRemote = false): GitBranch {
  return { name, ref: name, isCurrent: false, isRemote, commit: 'abc', message: '' };
}

describe('automation branch reference', () => {
  it('uses the chat environment when it may run, else the first allowed one', () => {
    expect(automationBranchEnvironmentId(['env-a', 'env-b'], 'env-b')).toBe('env-b');
    expect(automationBranchEnvironmentId(['env-a', 'env-b'], 'env-c')).toBe('env-a');
    expect(automationBranchEnvironmentId([], 'env-c')).toBe('env-c');
    expect(automationBranchEnvironmentId([], null)).toBeNull();
  });

  it('lists the environment-scoped VCS branches by name, one per name, local first', (done) => {
    const service = {
      getBranches: jest.fn(() => of([branch('release', true), branch('main'), branch('main', true)])),
    };

    automationBranchLoader(service, 'client-1', 'env-a', { local: 'Local', remote: 'Remote' })().subscribe(
      (options) => {
        expect(service.getBranches).toHaveBeenCalledWith('client-1', 'env-a');
        expect(options).toEqual([
          { value: 'main', detail: 'Local' },
          { value: 'release', detail: 'Remote' },
        ]);
        done();
      },
    );
  });
});
