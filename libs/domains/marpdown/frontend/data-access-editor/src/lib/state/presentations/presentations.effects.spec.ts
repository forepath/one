import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of, throwError } from 'rxjs';

import { PresentationsService } from '../../services/presentations.service';

import { loadPresentations, loadPresentationsFailure, loadPresentationsSuccess } from './presentations.actions';
import { loadPresentations$ } from './presentations.effects';

describe('presentations effects', () => {
  let actions$: Observable<unknown>;
  let presentationsService: jest.Mocked<Pick<PresentationsService, 'listPresentations'>>;

  beforeEach(() => {
    presentationsService = {
      listPresentations: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$)],
    });

    actions$ = TestBed.inject(Actions);
  });

  it('should dispatch success when list returns partial batch', (done) => {
    presentationsService.listPresentations.mockReturnValue(
      of({ items: [{ id: '1', title: 'A', createdAt: '', updatedAt: '' }], total: 1, limit: 10, offset: 0 }),
    );

    actions$ = of(loadPresentations({}));

    loadPresentations$(actions$ as Actions, presentationsService as PresentationsService).subscribe((action) => {
      expect(action).toEqual(
        loadPresentationsSuccess({
          presentations: [{ id: '1', title: 'A', createdAt: '', updatedAt: '' }],
          total: 1,
        }),
      );
      done();
    });
  });

  it('should dispatch failure on error', (done) => {
    presentationsService.listPresentations.mockReturnValue(throwError(() => new Error('boom')));

    actions$ = of(loadPresentations({}));

    loadPresentations$(actions$ as Actions, presentationsService as PresentationsService).subscribe((action) => {
      expect(action).toEqual(loadPresentationsFailure({ error: 'boom' }));
      done();
    });
  });
});
