import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  DeploymentsFacade,
  DeploymentsService,
  type DeploymentConfiguration,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { StandaloneLoadingService } from '@forepath/shared/frontend';
import { BehaviorSubject, firstValueFrom, of, throwError } from 'rxjs';

import { DeploymentConfigurationComponent } from './deployment-configuration.component';

describe('DeploymentConfigurationComponent (reference typeaheads)', () => {
  let fixture: ComponentFixture<DeploymentConfigurationComponent>;
  let component: DeploymentConfigurationComponent;
  let configuration$: BehaviorSubject<DeploymentConfiguration | null>;
  let service: { listRepositories: jest.Mock; listBranches: jest.Mock; listWorkflows: jest.Mock };

  beforeEach(async () => {
    configuration$ = new BehaviorSubject<DeploymentConfiguration | null>(null);
    const facade = {
      configuration$,
      repositories$: of([]),
      branches$: of([]),
      workflows$: of([]),
      loadingConfiguration$: of(false),
      loadingRepositories$: of(false),
      loadingBranches$: of(false),
      loadingWorkflows$: of(false),
      creatingConfiguration$: of(false),
      updatingConfiguration$: of(false),
      deletingConfiguration$: of(false),
      triggeringWorkflow$: of(false),
      error$: of(null),
      loadBranches: jest.fn(),
      loadWorkflows: jest.fn(),
    };

    service = {
      listRepositories: jest.fn(() =>
        of([
          {
            id: 'acme/app',
            name: 'app',
            fullName: 'acme/app',
            defaultBranch: 'main',
            url: '',
            private: true,
          },
        ]),
      ),
      listBranches: jest.fn(() => of([{ name: 'main', sha: 'a', default: true }])),
      listWorkflows: jest.fn(() =>
        of([{ id: '42', name: 'CI', path: '.github/workflows/ci.yml', state: 'active', canTrigger: true }]),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [DeploymentConfigurationComponent],
      providers: [
        { provide: DeploymentsFacade, useValue: facade },
        { provide: DeploymentsService, useValue: service },
        { provide: StandaloneLoadingService, useValue: { isLoading: () => false, setLoading: jest.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DeploymentConfigurationComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('clientId', 'client-1');
    fixture.componentRef.setInput('agentId', 'env-1');
    fixture.detectChanges();
  });

  function configure(): void {
    configuration$.next({
      id: 'cfg',
      agentId: 'env-1',
      providerType: 'github',
      repositoryId: 'acme/app',
      defaultBranch: 'main',
      createdAt: '',
      updatedAt: '',
    } as DeploymentConfiguration);
    fixture.detectChanges();
  }

  it('no configuration yet (no saved token): free text, no list calls', () => {
    expect(component.repositoryLoader()).toBeNull();
    expect(component.branchLoader()).toBeNull();
    expect(component.workflowLoader()).toBeNull();
  });

  it('repository picker lists the environment-scoped repositories, storing the repository id', async () => {
    configure();

    const options = await firstValueFrom(component.repositoryLoader()!());

    expect(service.listRepositories).toHaveBeenCalledWith('client-1', 'env-1');
    expect(options).toEqual([{ value: 'acme/app', label: 'acme/app', detail: 'Private' }]);
  });

  it('branch and workflow pickers follow the repository (and branch) in the form', async () => {
    configure();
    component.repositoryId.set('acme/app');
    component.defaultBranch.set('main');

    expect(await firstValueFrom(component.branchLoader()!())).toEqual([{ value: 'main', detail: 'Default branch' }]);
    expect(service.listBranches).toHaveBeenCalledWith('client-1', 'env-1', 'acme/app');

    expect(await firstValueFrom(component.workflowLoader()!())).toEqual([
      { value: '42', label: 'CI', detail: '.github/workflows/ci.yml' },
    ]);
    expect(service.listWorkflows).toHaveBeenCalledWith('client-1', 'env-1', 'acme/app', 'main');

    component.repositoryId.set('');
    expect(component.branchLoader()).toBeNull();
    expect(component.workflowLoader()).toBeNull();
  });

  it('a 403 from the provider list surfaces as an error the combobox turns into the typed-value hint', async () => {
    configure();
    service.listRepositories.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));

    await expect(firstValueFrom(component.repositoryLoader()!())).rejects.toBeInstanceOf(HttpErrorResponse);
  });
});
