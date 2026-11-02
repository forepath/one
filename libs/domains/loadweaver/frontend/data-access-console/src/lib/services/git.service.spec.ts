import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/loadweaver/frontend/util-configuration';
import { firstValueFrom } from 'rxjs';

import { ConsoleEndpointService } from './console-endpoint.service';
import { gitAccountsReturnUrl, GitService } from './git.service';

describe('GitService', () => {
  let service: GitService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ENVIRONMENT, useValue: { console: { urls: { restApi: 'https://cp.example.com/api/' } } } },
      ],
    });
    service = TestBed.inject(GitService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('rotates the webhook secret', async () => {
    const rotated = firstValueFrom(service.rotateWebhookSecret('c/1'));
    const req = http.expectOne('https://cp.example.com/api/git/connections/c%2F1/webhook-secret/rotate');

    expect(req.request.method).toBe('POST');
    req.flush({ webhookSecret: 'whsec', webhookGeneration: 1 });
    expect(await rotated).toEqual({ webhookSecret: 'whsec', webhookGeneration: 1 });
  });

  it('reads, confirms and cancels a pending account link', async () => {
    const pending = firstValueFrom(service.pendingAccountLink('n/1'));
    const get = http.expectOne('https://cp.example.com/api/git/accounts/pending/n%2F1');

    expect(get.request.method).toBe('GET');
    get.flush({ provider: 'github', login: 'octo', providerUserId: '1', expiresAt: '2026-10-18T10:00:00Z' });
    expect((await pending).login).toBe('octo');

    const confirmed = firstValueFrom(service.confirmAccountLink('n1'));
    const post = http.expectOne('https://cp.example.com/api/git/accounts/confirm');

    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ nonce: 'n1' });
    post.flush({ id: 'a1', provider: 'github', providerUserId: '1', login: 'octo', createdAt: '2026-10-18T10:00:00Z' });
    expect((await confirmed).id).toBe('a1');

    const cancelled = firstValueFrom(service.cancelAccountLink('n1'));
    const del = http.expectOne('https://cp.example.com/api/git/accounts/pending/n1');

    expect(del.request.method).toBe('DELETE');
    del.flush(null, { status: 204, statusText: 'No Content' });
    await cancelled;
  });

  it('starts linking natively without a return URL', async () => {
    const started = firstValueFrom(service.authorizeAccount('github'));
    const post = http.expectOne('https://cp.example.com/api/git/accounts/github/authorize');

    expect(post.request.body).toEqual({});
    post.flush({ url: 'https://github.com/login/oauth/authorize?x=1', expiresAt: '2026-10-29T10:00:00Z' });
    await started;
    expect(service.webhookUrl({ webhookPath: '/api/git/webhooks/c1' })).toBe(
      'https://cp.example.com/api/git/webhooks/c1',
    );
  });

  it('resolves this console’s Git accounts page below the base href', () => {
    expect(gitAccountsReturnUrl('https://fleet.example.com/de/')).toBe(
      'https://fleet.example.com/de/account/git-accounts',
    );
    expect(gitAccountsReturnUrl('https://fleet.example.com/?x=1#y')).toBe(
      'https://fleet.example.com/account/git-accounts',
    );
    expect(gitAccountsReturnUrl('')).toBeNull();
    expect(gitAccountsReturnUrl('not a url')).toBeNull();
  });
});

describe('GitService in fleet mode (3.41)', () => {
  const CLUSTER = '6f1c1b0e-0000-4000-8000-000000000001';

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ENVIRONMENT,
          useValue: {
            console: { urls: { restApi: 'https://cp.example.com/api/', websocket: { default: '' } } },
            mode: 'fleet',
            fleet: { apiUrl: 'https://fleet.example.com/api', websocketUrl: '' },
          },
        },
      ],
    });
    TestBed.inject(ConsoleEndpointService).setActiveCluster(CLUSTER);
  });

  afterEach(() => sessionStorage.clear());

  it('asks the cluster to return to this console after the provider, through the relay', async () => {
    const service = TestBed.inject(GitService);
    const http = TestBed.inject(HttpTestingController);
    const started = firstValueFrom(service.authorizeAccount('gitlab'));
    const post = http.expectOne(`https://fleet.example.com/api/clusters/${CLUSTER}/api/git/accounts/gitlab/authorize`);

    expect(post.request.body).toEqual({ returnUrl: gitAccountsReturnUrl() });
    expect(post.request.body.returnUrl).toMatch(/\/account\/git-accounts$/);
    post.flush({ url: 'https://gitlab.example.com/oauth/authorize', expiresAt: '2026-10-29T10:00:00Z' });
    await started;
    http.verify();
  });

  it('points webhooks at the cluster’s own public API, never at the relay', () => {
    const service = TestBed.inject(GitService);
    const endpoints = TestBed.inject(ConsoleEndpointService);

    endpoints.setClusterPublicUrls(CLUSTER, 'https://cp.example.com', null);
    expect(service.webhookUrl({ webhookPath: '/api/git/webhooks/c1' })).toBe(
      'https://cp.example.com/api/git/webhooks/c1',
    );
  });
});
