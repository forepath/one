import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router, type ActivatedRouteSnapshot, type UrlTree } from '@angular/router';
// Match guard import: avoid data-access barrel (identity / Keycloak).
// eslint-disable-next-line @nx/enforce-module-boundaries
import { ClientsFacade } from '@forepath/agenstra/frontend/data-access-agent-console';
import { firstValueFrom, isObservable, of, type Observable } from 'rxjs';

import { ticketsRequireActiveClientGuard } from './tickets-require-active-client.guard';

describe('ticketsRequireActiveClientGuard', () => {
  const mockParentRoute = { path: 'parent' };
  let mockRouter: { createUrlTree: jest.Mock };
  let mockActivatedRoute: { parent: typeof mockParentRoute };
  let clientsFacadeStub: {
    activeClientId$: Observable<string | null>;
    setActiveClient: jest.Mock;
  };
  const createInjector = (): Injector => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ClientsFacade, useValue: clientsFacadeStub },
        { provide: Router, useValue: mockRouter },
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
      ],
    });

    return TestBed.inject(Injector);
  };

  async function runGuard(route: ActivatedRouteSnapshot): Promise<boolean | UrlTree> {
    const injector = createInjector();
    const raw = runInInjectionContext(injector, () => ticketsRequireActiveClientGuard(route, {} as never));

    if (isObservable(raw)) {
      return firstValueFrom(raw as Observable<boolean | UrlTree>);
    }

    return raw as boolean | UrlTree;
  }

  beforeEach(() => {
    mockRouter = {
      createUrlTree: jest.fn(),
    };
    mockActivatedRoute = { parent: mockParentRoute };
    clientsFacadeStub = {
      activeClientId$: of(null),
      setActiveClient: jest.fn(),
    };
    jest.clearAllMocks();
  });

  it('sets active client from :clientId and allows activation', async () => {
    const route = {
      paramMap: convertToParamMap({ clientId: '550e8400-e29b-41d4-a716-446655440000' }),
    } as ActivatedRouteSnapshot;
    const result = await runGuard(route);

    expect(clientsFacadeStub.setActiveClient).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000');
    expect(result).toBe(true);
    expect(mockRouter.createUrlTree).not.toHaveBeenCalled();
  });

  it('trims client id from URL param', async () => {
    const route = { paramMap: convertToParamMap({ clientId: '  abc  ' }) } as ActivatedRouteSnapshot;
    const result = await runGuard(route);

    expect(clientsFacadeStub.setActiveClient).toHaveBeenCalledWith('abc');
    expect(result).toBe(true);
  });

  it('redirects to /tickets/:id when no param but a workspace is selected', async () => {
    clientsFacadeStub.activeClientId$ = of('550e8400-e29b-41d4-a716-446655440000');
    const mockUrlTree = { toString: () => '/tickets/uuid' } as UrlTree;

    mockRouter.createUrlTree.mockReturnValue(mockUrlTree);
    const route = { paramMap: convertToParamMap({}) } as ActivatedRouteSnapshot;
    const result = await runGuard(route);

    expect(result).toBe(mockUrlTree);
    expect(mockRouter.createUrlTree).toHaveBeenCalledTimes(1);
    expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['tickets', '550e8400-e29b-41d4-a716-446655440000'], {
      relativeTo: mockParentRoute,
    });
  });

  it('allows activation when no param and no workspace (board opens workspace picker)', async () => {
    const route = { paramMap: convertToParamMap({}) } as ActivatedRouteSnapshot;
    const result = await runGuard(route);

    expect(result).toBe(true);
    expect(mockRouter.createUrlTree).not.toHaveBeenCalled();
  });

  it('allows activation when no param and activeClientId is empty string', async () => {
    clientsFacadeStub.activeClientId$ = of('');
    const route = { paramMap: convertToParamMap({}) } as ActivatedRouteSnapshot;
    const result = await runGuard(route);

    expect(result).toBe(true);
    expect(mockRouter.createUrlTree).not.toHaveBeenCalled();
  });
});
