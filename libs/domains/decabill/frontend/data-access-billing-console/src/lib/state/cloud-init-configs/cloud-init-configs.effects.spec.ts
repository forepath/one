import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of, throwError } from 'rxjs';
import { Action } from '@ngrx/store';

import { CloudInitConfigsService } from '../../services/cloud-init-configs.service';
import {
  loadCloudInitConfigs,
  loadCloudInitConfigsSuccess,
  loadCloudInitConfigsFailure,
} from './cloud-init-configs.actions';
import { loadCloudInitConfigs$ } from './cloud-init-configs.effects';

describe('cloudInitConfigsEffects', () => {
  let actions$: Observable<Action>;
  let cloudInitConfigsService: jest.Mocked<CloudInitConfigsService>;

  beforeEach(() => {
    cloudInitConfigsService = {
      listCloudInitConfigs: jest.fn(),
    } as unknown as jest.Mocked<CloudInitConfigsService>;

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        { provide: CloudInitConfigsService, useValue: cloudInitConfigsService },
      ],
    });
  });

  it('loadCloudInitConfigs$ emits success', (done) => {
    const configs = [{ id: 'cfg-1' }];
    cloudInitConfigsService.listCloudInitConfigs.mockReturnValue(of(configs as never));
    actions$ = of(loadCloudInitConfigs({}));

    TestBed.runInInjectionContext(() => {
      loadCloudInitConfigs$(actions$, cloudInitConfigsService).subscribe((action) => {
        expect(action).toEqual(loadCloudInitConfigsSuccess({ cloudInitConfigs: configs as never }));
        done();
      });
    });
  });

  it('loadCloudInitConfigs$ emits failure', (done) => {
    cloudInitConfigsService.listCloudInitConfigs.mockReturnValue(throwError(() => new Error('fail')));
    actions$ = of(loadCloudInitConfigs({}));

    TestBed.runInInjectionContext(() => {
      loadCloudInitConfigs$(actions$, cloudInitConfigsService).subscribe((action) => {
        expect(action).toEqual(loadCloudInitConfigsFailure({ error: 'fail' }));
        done();
      });
    });
  });
});
