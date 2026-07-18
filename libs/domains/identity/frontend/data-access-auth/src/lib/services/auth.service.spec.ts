import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { createMockIdentityAuthEnvironment, IDENTITY_AUTH_ENVIRONMENT } from '@forepath/identity/frontend';

import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3000/api';

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AuthService,
        {
          provide: IDENTITY_AUTH_ENVIRONMENT,
          useValue: createMockIdentityAuthEnvironment({ apiUrl }),
        },
      ],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('login posts credentials to /auth/login', (done) => {
    const response = { access_token: 'token', user: { id: '1', email: 'a@b.com', role: 'user' } };

    service.login('a@b.com', 'secret').subscribe((result) => {
      expect(result).toEqual(response);
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/auth/login`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'a@b.com', password: 'secret' });
    req.flush(response);
  });

  it('register posts credentials to /auth/register', (done) => {
    service.register('a@b.com', 'secret').subscribe(() => done());

    const req = httpMock.expectOne(`${apiUrl}/auth/register`);

    expect(req.request.method).toBe('POST');
    req.flush({ message: 'ok' });
  });

  it('confirmEmail posts email and code', (done) => {
    service.confirmEmail('a@b.com', '123456').subscribe(() => done());

    const req = httpMock.expectOne(`${apiUrl}/auth/confirm-email`);

    expect(req.request.body).toEqual({ email: 'a@b.com', code: '123456' });
    req.flush({ message: 'confirmed' });
  });

  it('requestPasswordReset posts email', (done) => {
    service.requestPasswordReset('a@b.com').subscribe(() => done());

    const req = httpMock.expectOne(`${apiUrl}/auth/request-password-reset`);

    expect(req.request.body).toEqual({ email: 'a@b.com' });
    req.flush({ message: 'sent' });
  });

  it('resetPassword posts reset payload', (done) => {
    service.resetPassword('a@b.com', '123456', 'new-secret').subscribe(() => done());

    const req = httpMock.expectOne(`${apiUrl}/auth/reset-password`);

    expect(req.request.body).toEqual({ email: 'a@b.com', code: '123456', newPassword: 'new-secret' });
    req.flush({ message: 'reset' });
  });

  it('changePassword posts password change payload', (done) => {
    service.changePassword('old', 'new', 'new').subscribe((result) => {
      expect(result).toEqual({ message: 'changed', access_token: 'new-token' });
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/auth/change-password`);

    expect(req.request.body).toEqual({
      currentPassword: 'old',
      newPassword: 'new',
      newPasswordConfirmation: 'new',
    });
    req.flush({ message: 'changed', access_token: 'new-token' });
  });

  it('logout posts to /auth/logout', (done) => {
    service.logout(false).subscribe(() => done());

    const req = httpMock.expectOne(`${apiUrl}/auth/logout`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ invalidateAllSessions: false });
    req.flush(null);
  });

  it('logout posts invalidateAllSessions when requested', (done) => {
    service.logout(true).subscribe(() => done());

    const req = httpMock.expectOne(`${apiUrl}/auth/logout`);

    expect(req.request.body).toEqual({ invalidateAllSessions: true });
    req.flush(null);
  });

  it('listUsers GETs /users without params when omitted', (done) => {
    service.listUsers().subscribe(() => done());

    const req = httpMock.expectOne(`${apiUrl}/users`);

    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys().length).toBe(0);
    req.flush([]);
  });

  it('listUsers forwards limit and offset query params', (done) => {
    service.listUsers({ limit: 10, offset: 20 }).subscribe(() => done());

    const req = httpMock.expectOne((r) => r.url === `${apiUrl}/users`);

    expect(req.request.params.get('limit')).toBe('10');
    expect(req.request.params.get('offset')).toBe('20');
    req.flush([]);
  });

  it('getUser GETs /users/:id', (done) => {
    service.getUser('user-1').subscribe(() => done());

    const req = httpMock.expectOne(`${apiUrl}/users/user-1`);

    expect(req.request.method).toBe('GET');
    req.flush({ id: 'user-1', email: 'a@b.com', role: 'user' });
  });

  it('createUser POSTs to /users', (done) => {
    const dto = { email: 'new@b.com', password: 'secret', role: 'user' as const };

    service.createUser(dto).subscribe(() => done());

    const req = httpMock.expectOne(`${apiUrl}/users`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(dto);
    req.flush({ id: 'user-2', email: 'new@b.com', role: 'user' });
  });

  it('updateUser POSTs to /users/:id', (done) => {
    service.updateUser('user-1', { role: 'admin' }).subscribe(() => done());

    const req = httpMock.expectOne(`${apiUrl}/users/user-1`);

    expect(req.request.method).toBe('POST');
    req.flush({ id: 'user-1', email: 'a@b.com', role: 'admin' });
  });

  it('deleteUser DELETEs /users/:id', (done) => {
    service.deleteUser('user-1').subscribe(() => done());

    const req = httpMock.expectOne(`${apiUrl}/users/user-1`);

    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('lockUser POSTs to /users/:id/lock', (done) => {
    service.lockUser('user-1').subscribe(() => done());

    const req = httpMock.expectOne(`${apiUrl}/users/user-1/lock`);

    expect(req.request.method).toBe('POST');
    req.flush({ id: 'user-1', email: 'a@b.com', role: 'user' });
  });

  it('unlockUser POSTs to /users/:id/unlock', (done) => {
    service.unlockUser('user-1').subscribe(() => done());

    const req = httpMock.expectOne(`${apiUrl}/users/user-1/unlock`);

    expect(req.request.method).toBe('POST');
    req.flush({ id: 'user-1', email: 'a@b.com', role: 'user' });
  });

  it('listTokenScopes GETs /auth/token-scopes', (done) => {
    service.listTokenScopes().subscribe((result) => {
      expect(result).toEqual([{ scope: 'read' }]);
      done();
    });

    const req = httpMock.expectOne(`${apiUrl}/auth/token-scopes`);

    expect(req.request.method).toBe('GET');
    req.flush([{ scope: 'read' }]);
  });

  it('listPersonalAccessTokens GETs /auth/tokens', (done) => {
    service.listPersonalAccessTokens().subscribe(() => done());

    const req = httpMock.expectOne(`${apiUrl}/auth/tokens`);

    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('createPersonalAccessToken POSTs to /auth/tokens', (done) => {
    const dto = { name: 'CI', scopes: ['read'] };

    service.createPersonalAccessToken(dto).subscribe(() => done());

    const req = httpMock.expectOne(`${apiUrl}/auth/tokens`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(dto);
    req.flush({
      id: '1',
      name: 'CI',
      tokenPrefix: 'fp_pat_x',
      scopes: ['read'],
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      token: 'fp_pat_secret',
    });
  });

  it('revokePersonalAccessToken DELETEs /auth/tokens/:id', (done) => {
    service.revokePersonalAccessToken('token-1').subscribe(() => done());

    const req = httpMock.expectOne(`${apiUrl}/auth/tokens/token-1`);

    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('updatePersonalAccessToken PATCHes /auth/tokens/:id', (done) => {
    const dto = { name: 'CI', scopes: ['write'] };

    service.updatePersonalAccessToken('token-1', dto).subscribe(() => done());

    const req = httpMock.expectOne(`${apiUrl}/auth/tokens/token-1`);

    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual(dto);
    req.flush({
      id: 'token-1',
      name: 'CI',
      tokenPrefix: 'fp_pat_x',
      scopes: ['write'],
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: '2024-01-01T00:00:00.000Z',
    });
  });

  it('listUserPersonalAccessTokens GETs /users/:userId/tokens', (done) => {
    service.listUserPersonalAccessTokens('user-1').subscribe(() => done());

    const req = httpMock.expectOne(`${apiUrl}/users/user-1/tokens`);

    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('revokeUserPersonalAccessToken DELETEs /users/:userId/tokens/:tokenId', (done) => {
    service.revokeUserPersonalAccessToken('user-1', 'token-1').subscribe(() => done());

    const req = httpMock.expectOne(`${apiUrl}/users/user-1/tokens/token-1`);

    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
});
