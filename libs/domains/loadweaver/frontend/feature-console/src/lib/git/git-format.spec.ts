import { testGitConnection, testPlan } from '../testing';
import {
  gitApplyBlockers,
  gitConflicts,
  hasPendingPullRequests,
  mayApprove,
  safeExternalUrl,
} from '../plans/plan-format';
import {
  createRequestOf,
  emptyGitForm,
  gitCommitStateLabel,
  gitFormOf,
  githubAppResetByEdit,
  gitModeLabel,
  gitProviderLabel,
  gitFleetIdentityGap,
  mayAdministerGitScope,
  planSourceLabel,
  updateRequestOf,
  validateGitForm,
} from './git-format';

describe('git format', () => {
  it('labels providers, modes, states and plan sources', () => {
    expect(gitProviderLabel('gitea')).toBe('Gitea / Forgejo');
    expect(gitProviderLabel('git')).toBe('Plain Git');
    expect(gitModeLabel('authoritative')).toBe('Git is authoritative');
    expect(gitCommitStateLabel('rejected')).toBe('Rejected');
    expect(planSourceLabel('ui')).toBe('Console');
  });

  it('lets cluster admins manage the cluster scope and project admins their projects', () => {
    expect(mayAdministerGitScope({ userId: 'a', clusterRole: 'cluster-admin', projects: {} }, null)).toBe(true);
    expect(mayAdministerGitScope({ userId: 'a', clusterRole: 'cluster-admin', projects: {} }, 'shop')).toBe(true);
    expect(mayAdministerGitScope({ userId: 'a', clusterRole: 'infra-operator', projects: {} }, null)).toBe(false);
    expect(mayAdministerGitScope({ userId: 'a', clusterRole: null, projects: { shop: 'admin' } }, 'shop')).toBe(true);
    expect(mayAdministerGitScope({ userId: 'a', clusterRole: null, projects: { shop: 'operator' } }, 'shop')).toBe(
      false,
    );
    expect(mayAdministerGitScope(null, 'shop')).toBe(false);
  });

  it('in fleet mode needs the verified person for project admins, not for cluster-wide admins (3.41)', () => {
    const projectAdmin = { userId: null, clusterRole: null, projects: { shop: 'admin' as const } };

    expect(mayAdministerGitScope(projectAdmin, 'shop', true)).toBe(false);
    expect(mayAdministerGitScope({ ...projectAdmin, fleetIdentity: true }, 'shop', true)).toBe(true);
    expect(mayAdministerGitScope({ ...projectAdmin, fleetIdentity: true }, null, true)).toBe(false);
    expect(mayAdministerGitScope({ userId: null, clusterRole: 'cluster-admin', projects: {} }, null, true)).toBe(true);

    expect(gitFleetIdentityGap(false, projectAdmin)).toBeNull();
    expect(gitFleetIdentityGap(true, projectAdmin)).toBe('read');
    expect(gitFleetIdentityGap(true, { ...projectAdmin, fleetIdentity: true })).toBeNull();
    expect(gitFleetIdentityGap(true, { ...projectAdmin, clusterRole: 'auditor' })).toBe('manage');
    expect(gitFleetIdentityGap(true, { userId: null, clusterRole: 'auditor', projects: {} })).toBeNull();
    expect(gitFleetIdentityGap(true, { userId: null, clusterRole: 'cluster-admin', projects: {} })).toBeNull();
  });

  it('validates the form like the API and round-trips a connection', () => {
    const form = { ...emptyGitForm('shop'), repoUrl: 'https://github.com/acme/infra.git' };

    expect(validateGitForm(form, ['shop'])).toEqual([]);
    expect(validateGitForm(form, ['web'])).toEqual(['scope']);
    expect(validateGitForm({ ...form, branch: 'a..b', path: '../x' })).toEqual(['branch', 'path']);
    expect(validateGitForm({ ...form, credentials: 'plain-token' })).toEqual(['credentials']);
    // The cluster scope may use any project's secret.
    expect(validateGitForm({ ...form, scope: '', credentials: 'secret://ops/token' })).toEqual([]);
    expect(validateGitForm({ ...form, apiUrl: 'http://git.example' })).toEqual(['apiUrl']);

    const connection = testGitConnection();

    expect(createRequestOf(gitFormOf(connection))).toMatchObject({ project: 'shop', pollIntervalSeconds: 60 });
    expect(updateRequestOf(gitFormOf(connection), connection)).toEqual({});
    expect(updateRequestOf({ ...gitFormOf(connection), branch: 'prod' }, connection)).toEqual({ branch: 'prod' });
  });

  it('finds git conflicts and authoritative blockers on plans', () => {
    const conflict = { path: 'git-conflict', message: 'Deployment shop/web changed outside Git' };
    const authoritative = testGitConnection({ mode: 'authoritative' });

    expect(gitConflicts(testPlan({ warnings: [conflict, { message: 'other' }] }))).toEqual([conflict]);

    const ui = testPlan({ source: { kind: 'ui' } });

    expect(gitApplyBlockers(ui, [authoritative]).map((b) => b.connectionId)).toEqual([authoritative.id]);
    expect(gitApplyBlockers(ui, [testGitConnection()])).toEqual([]);
    expect(gitApplyBlockers(testPlan({ source: { kind: 'git' } }), [authoritative])).toEqual([]);
    expect(gitApplyBlockers(testPlan({ source: { kind: 'system' } }), [authoritative])).toEqual([]);

    // A pull request of a scope the caller can't read still blocks.
    const unreadable = testPlan({
      source: { kind: 'api', pullRequests: [{ connection: 'hidden', branch: 'loadweaver/plan-1', error: 'no token' }] },
    });

    expect(gitApplyBlockers(unreadable, [])).toEqual([
      {
        connectionId: 'hidden',
        connection: null,
        pullRequest: { connection: 'hidden', branch: 'loadweaver/plan-1', error: 'no token' },
      },
    ]);
  });

  it('sends the GitHub App only for GitHub and knows when an edit turns it off', () => {
    const app = testGitConnection({ githubApp: true, credentials: null });

    expect(createRequestOf({ ...gitFormOf(app), provider: 'gitlab' }).githubApp).toBe(false);
    expect(createRequestOf(gitFormOf(app)).githubApp).toBe(true);
    expect(updateRequestOf({ ...gitFormOf(app), githubApp: false }, app)).toEqual({ githubApp: false });

    expect(githubAppResetByEdit(gitFormOf(app), app, false)).toBe(false);
    expect(githubAppResetByEdit({ ...gitFormOf(app), apiUrl: 'https://ghe.example/api/v3' }, app, false)).toBe(true);
    expect(githubAppResetByEdit({ ...gitFormOf(app), provider: 'gitea' }, app, false)).toBe(true);
    expect(githubAppResetByEdit({ ...gitFormOf(app), branch: 'release' }, app, false)).toBe(false);
    expect(githubAppResetByEdit({ ...gitFormOf(app), provider: 'gitea' }, app, true)).toBe(false);
    expect(githubAppResetByEdit(emptyGitForm(), null, false)).toBe(false);
  });

  it('keeps the change authors from approving and tells pending pull requests apart', () => {
    const me = { userId: 'dev', clusterRole: null, projects: { shop: 'operator' } } as const;
    const plan = testPlan({ createdBy: 'bot', source: { kind: 'git', authors: ['dev'] } });

    expect(mayApprove(testPlan({ createdBy: 'bot' }), { ...me, projects: { ...me.projects } })).toBe(true);
    expect(mayApprove(plan, { ...me, projects: { ...me.projects } })).toBe(false);

    expect(hasPendingPullRequests(testPlan())).toBe(false);
    expect(
      hasPendingPullRequests(
        testPlan({ source: { kind: 'ui', pullRequests: [{ connection: 'c', branch: 'b', pending: true }] } }),
      ),
    ).toBe(true);
    expect(
      hasPendingPullRequests(
        testPlan({
          source: { kind: 'ui', pullRequests: [{ connection: 'c', branch: 'b', url: 'https://x/pull/1', number: 1 }] },
        }),
      ),
    ).toBe(false);

    expect(safeExternalUrl('https://github.com/acme/infra/pull/3')).toBe('https://github.com/acme/infra/pull/3');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('not a url')).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
  });
});
