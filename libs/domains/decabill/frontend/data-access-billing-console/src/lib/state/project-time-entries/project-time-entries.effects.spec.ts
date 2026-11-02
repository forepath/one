import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of, throwError } from 'rxjs';

import { ProjectTimeEntriesService } from '../../services/project-time-entries.service';

import { loadProjectTimeEntries, loadProjectTimeEntriesSuccess } from './project-time-entries.actions';
import { loadProjectTimeEntries$ } from './project-time-entries.effects';

describe('projectTimeEntries effects', () => {
  let actions$: Observable<unknown>;
  let service: { list: jest.Mock };

  beforeEach(() => {
    service = { list: jest.fn() };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: ProjectTimeEntriesService, useValue: service }],
    });
  });

  it('loads one page of the project time entries with the total (replace-page)', (done) => {
    service.list.mockReturnValue(of({ items: [{ id: 'e-1' }], total: 51, limit: 25, offset: 50 }));
    actions$ = of(loadProjectTimeEntries({ projectId: 'p-1', page: 3 }));

    TestBed.runInInjectionContext(() => {
      loadProjectTimeEntries$(actions$, service as never).subscribe((action) => {
        expect(action).toEqual(loadProjectTimeEntriesSuccess({ entries: [{ id: 'e-1' }] as never, total: 51 }));
        expect(service.list).toHaveBeenCalledTimes(1);
        expect(service.list).toHaveBeenCalledWith('p-1', { limit: 25, offset: 50 });
        done();
      });
    });
  });

  it('uses the requested page size', (done) => {
    service.list.mockReturnValue(of({ items: [], total: 0, limit: 50, offset: 50 }));
    actions$ = of(loadProjectTimeEntries({ projectId: 'p-1', page: 2, pageSize: 50 }));

    TestBed.runInInjectionContext(() => {
      loadProjectTimeEntries$(actions$, service as never).subscribe(() => {
        expect(service.list).toHaveBeenCalledWith('p-1', { limit: 50, offset: 50 });
        done();
      });
    });
  });

  it('maps load errors', (done) => {
    service.list.mockReturnValue(throwError(() => new Error('load failed')));
    actions$ = of(loadProjectTimeEntries({ projectId: 'p-1' }));

    TestBed.runInInjectionContext(() => {
      loadProjectTimeEntries$(actions$, service as never).subscribe((action) => {
        expect(action).toEqual(
          expect.objectContaining({ type: '[ProjectTimeEntries] Load Failure', error: 'load failed' }),
        );
        done();
      });
    });
  });
});
