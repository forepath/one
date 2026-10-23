import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConsoleGitFacade, type GitConnection } from '@forepath/loadweaver/frontend/data-access-console';
import { BehaviorSubject } from 'rxjs';

import { gitStub, testGitConnection } from '../testing';
import { LoadweaverGitConnectionModalComponent } from './git-connection-modal.component';

describe('LoadweaverGitConnectionModalComponent', () => {
  let fixture: ComponentFixture<LoadweaverGitConnectionModalComponent>;
  let git: ReturnType<typeof gitStub>;

  async function setup(connection: GitConnection | null, scopes: string[] = ['', 'shop'], clusterAdmin = false) {
    git = gitStub([]);
    (git['webhookUrl'] as jest.Mock).mockReturnValue('https://lw.example/api/git/webhooks/new');

    await TestBed.configureTestingModule({
      imports: [LoadweaverGitConnectionModalComponent],
      providers: [{ provide: ConsoleGitFacade, useValue: git }],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverGitConnectionModalComponent);
    fixture.componentRef.setInput('connection', connection);
    fixture.componentRef.setInput('scopes', scopes);
    fixture.componentRef.setInput('clusterAdmin', clusterAdmin);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('validates and connects a new repository, then shows the webhook secret once', async () => {
    await setup(null);

    const component = fixture.componentInstance;

    expect(git['clearSave']).toHaveBeenCalled();
    expect(component.form().scope).toBe('');

    component.save();
    expect(component.isInvalid('repoUrl')).toBe(true);
    expect(git['create']).not.toHaveBeenCalled();

    component.update('scope', 'shop');
    expect(component.form().path).toBe('shop');
    component.update('repoUrl', 'http://github.com/acme/infra.git');
    component.save();
    expect(component.isInvalid('repoUrl')).toBe(true);

    component.update('repoUrl', 'git@github.com:acme/infra.git');
    component.save();
    // SSH needs a deploy key.
    expect(component.isInvalid('credentials')).toBe(true);

    component.update('credentials', 'secret://other/key');
    component.save();
    // A project's connection only uses its own secrets.
    expect(component.isInvalid('credentials')).toBe(true);

    component.update('credentials', 'secret://shop/deploy-key');
    component.update('mode', 'authoritative');
    component.update('pollIntervalSeconds', '5');
    component.save();
    expect(component.isInvalid('trigger')).toBe(true);

    component.update('pollIntervalSeconds', '120');
    component.save();
    expect(component.invalid()).toEqual([]);
    expect(git['create']).toHaveBeenCalledWith({
      project: 'shop',
      provider: 'github',
      repoUrl: 'git@github.com:acme/infra.git',
      branch: 'main',
      mode: 'authoritative',
      path: 'shop',
      credentials: 'secret://shop/deploy-key',
      apiUrl: null,
      caCertificate: null,
      webhook: true,
      pollIntervalSeconds: 120,
      approvalByMergeReview: false,
      membershipsFromGit: false,
      autoMerge: true,
      sops: false,
      githubApp: false,
    });

    (git['saved$'] as BehaviorSubject<unknown>).next('new');
    (git['created$'] as BehaviorSubject<unknown>).next({
      ...testGitConnection({ id: 'new' }),
      webhookSecret: 'whsec_once',
    });
    fixture.detectChanges();

    // Stays open to show the secret.
    expect(component.open()).toBe(true);
    expect((el().querySelector('[data-testid="git-created-secret"] input') as HTMLInputElement).value).toBe(
      'whsec_once',
    );
    expect((el().querySelector('[data-testid="git-created-url"] input') as HTMLInputElement).value).toBe(
      'https://lw.example/api/git/webhooks/new',
    );

    component.close();
    expect(component.open()).toBe(false);
  });

  it('sends only what changed and closes after saving', async () => {
    const connection = testGitConnection();

    await setup(connection, []);

    const component = fixture.componentInstance;

    component.save();
    expect(component.nothingChanged()).toBe(true);
    expect(git['update']).not.toHaveBeenCalled();

    component.update('mode', 'authoritative');
    component.update('polling', false);
    component.save();
    expect(git['update']).toHaveBeenCalledWith(connection.id, { mode: 'authoritative', pollIntervalSeconds: null });

    (git['saved$'] as BehaviorSubject<unknown>).next(connection.id);
    fixture.detectChanges();
    expect(component.open()).toBe(false);
  });

  it('refuses no trigger, a private key as CA and an API URL for plain Git', async () => {
    await setup(testGitConnection(), []);

    const component = fixture.componentInstance;

    component.update('webhook', false);
    component.update('polling', false);
    component.update('caCertificate', '-----BEGIN CERTIFICATE-----\n-----BEGIN PRIVATE KEY-----');
    component.update('provider', 'git');
    component.update('apiUrl', 'https://git.example/api');
    component.save();

    expect(component.invalid()).toEqual(expect.arrayContaining(['trigger', 'caCertificate', 'apiUrl']));
    expect(git['update']).not.toHaveBeenCalled();
  });

  const appToggle = () => el().querySelector('[data-testid="git-form-github-app"] input') as HTMLInputElement | null;

  it('lets cluster admins enable the GitHub App for GitHub connections', async () => {
    await setup(testGitConnection({ credentials: null }), [], true);

    const component = fixture.componentInstance;

    expect(appToggle()).not.toBeNull();
    expect(appToggle()?.disabled).toBe(false);
    expect(el().textContent).toContain('Cluster.spec.git.github.apiUrl');

    component.update('githubApp', true);
    component.save();
    expect(git['update']).toHaveBeenCalledWith(testGitConnection().id, { githubApp: true });

    // Not for other providers.
    component.update('provider', 'gitlab');
    fixture.detectChanges();
    expect(appToggle()).toBeNull();
  });

  it('hides the GitHub App from other admins while it is off and shows it read-only while on', async () => {
    await setup(testGitConnection(), []);

    expect(appToggle()).toBeNull();

    TestBed.resetTestingModule();
    await setup(testGitConnection({ githubApp: true, credentials: null }), []);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;

    expect(appToggle()).not.toBeNull();
    expect(appToggle()?.disabled).toBe(true);
    expect(el().querySelector('[data-testid="git-form-github-app-reset"]')).toBeNull();

    // Pointing it elsewhere turns the app off at the control plane.
    component.update('repoUrl', 'https://github.com/acme/other.git');
    fixture.detectChanges();
    expect(component.githubAppReset()).toBe(true);
    expect(el().querySelector('[data-testid="git-form-github-app-reset"]')).not.toBeNull();

    component.save();
    expect(git['update']).toHaveBeenCalledWith(testGitConnection().id, {
      repoUrl: 'https://github.com/acme/other.git',
    });
  });

  it('warns cluster admins about nothing when they repoint a GitHub App connection', async () => {
    await setup(testGitConnection({ githubApp: true, credentials: null }), [], true);

    fixture.componentInstance.update('repoUrl', 'https://github.com/acme/other.git');
    fixture.detectChanges();
    expect(fixture.componentInstance.githubAppReset()).toBe(false);
  });
});
