import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of, throwError } from 'rxjs';

import { WorkspaceConfigService } from '../../services/workspace-config.service';

import {
  loadWorkspaceConfigurationOverrides,
  loadWorkspaceConfigurationOverridesFailure,
  loadWorkspaceConfigurationOverridesSuccess,
} from './workspace-config.actions';
import { loadWorkspaceConfigurationOverrides$ } from './workspace-config.effects';

describe('workspace-config effects', () => {
  let actions$: Observable<any>;
  let service: jest.Mocked<WorkspaceConfigService>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        {
          provide: WorkspaceConfigService,
          useValue: {
            listConfigurationOverrides: jest.fn(),
          },
        },
      ],
    });
    service = TestBed.inject(WorkspaceConfigService) as jest.Mocked<WorkspaceConfigService>;
  });

  it('emits success when load works', (done) => {
    actions$ = of(loadWorkspaceConfigurationOverrides({ clientId: 'c1' }));
    service.listConfigurationOverrides.mockReturnValue(of([]));

    loadWorkspaceConfigurationOverrides$(actions$, service).subscribe((action) => {
      expect(action).toEqual(loadWorkspaceConfigurationOverridesSuccess({ clientId: 'c1', settings: [] }));
      done();
    });
  });

  it('emits failure when load fails', (done) => {
    actions$ = of(loadWorkspaceConfigurationOverrides({ clientId: 'c1' }));
    service.listConfigurationOverrides.mockReturnValue(throwError(() => new Error('boom')));

    loadWorkspaceConfigurationOverrides$(actions$, service).subscribe((action) => {
      expect(action).toEqual(loadWorkspaceConfigurationOverridesFailure({ clientId: 'c1', error: 'boom' }));
      done();
    });
  });
});
