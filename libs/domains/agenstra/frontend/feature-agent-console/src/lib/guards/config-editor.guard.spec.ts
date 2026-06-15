import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router, type ActivatedRouteSnapshot, type UrlTree } from '@angular/router';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { ClientsFacade } from '@forepath/agenstra/frontend/data-access-agent-console';
import { firstValueFrom, isObservable, of, type Observable } from 'rxjs';

import { configEditorGuard } from './config-editor.guard';

describe('configEditorGuard', () => {
  const mockParentRoute = { path: 'parent' };
  let mockRouter: { createUrlTree: jest.Mock };
  let mockActivatedRoute: { parent: typeof mockParentRoute };
  let clientsFacadeStub: {
    getClientById$: jest.Mock;
    loadClient: jest.Mock;
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
    const raw = runInInjectionContext(injector, () => configEditorGuard(route, {} as never));

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
      getClientById$: jest.fn(),
      loadClient: jest.fn(),
      setActiveClient: jest.fn(),
    };
    jest.clearAllMocks();
  });

  it('allows activation when the user can manage workspace configuration', async () => {
    clientsFacadeStub.getClientById$.mockReturnValue(
      of({
        id: 'c1',
        canManageWorkspaceConfiguration: true,
      } as never),
    );
    const route = {
      paramMap: convertToParamMap({ clientId: 'c1', agentId: 'a1' }),
    } as ActivatedRouteSnapshot;
    const result = await runGuard(route);

    expect(clientsFacadeStub.setActiveClient).toHaveBeenCalledWith('c1');
    expect(clientsFacadeStub.loadClient).toHaveBeenCalledWith('c1');
    expect(result).toBe(true);
    expect(mockRouter.createUrlTree).not.toHaveBeenCalled();
  });

  it('redirects to agent chat when the user cannot manage workspace configuration', async () => {
    const urlTree = { toString: () => '/clients/c1/agents/a1' } as UrlTree;

    mockRouter.createUrlTree.mockReturnValue(urlTree);
    clientsFacadeStub.getClientById$.mockReturnValue(
      of({
        id: 'c1',
        canManageWorkspaceConfiguration: false,
      } as never),
    );
    const route = {
      paramMap: convertToParamMap({ clientId: 'c1', agentId: 'a1' }),
    } as ActivatedRouteSnapshot;
    const result = await runGuard(route);

    expect(result).toBe(urlTree);
    expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['clients', 'c1', 'agents', 'a1']);
  });

  it('redirects to /clients when client or agent id is missing', async () => {
    const urlTree = { toString: () => '/clients' } as UrlTree;

    mockRouter.createUrlTree.mockReturnValue(urlTree);
    const route = { paramMap: convertToParamMap({ clientId: 'c1' }) } as ActivatedRouteSnapshot;
    const result = await runGuard(route);

    expect(result).toBe(urlTree);
    expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['clients']);
    expect(clientsFacadeStub.loadClient).not.toHaveBeenCalled();
  });
});
