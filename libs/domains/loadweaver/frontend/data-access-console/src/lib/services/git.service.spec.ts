import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/loadweaver/frontend/util-configuration';
import { firstValueFrom } from 'rxjs';

import { GitService } from './git.service';

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
});
