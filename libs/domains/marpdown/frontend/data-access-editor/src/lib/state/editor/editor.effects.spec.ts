import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { Store } from '@ngrx/store';
import { Observable, of } from 'rxjs';

import { PresentationsService } from '../../services/presentations.service';

import { saveEditor, saveEditorSuccess } from './editor.actions';
import { saveEditor$ } from './editor.effects';

describe('editor effects', () => {
  let actions$: Observable<unknown>;
  let presentationsService: jest.Mocked<Pick<PresentationsService, 'updatePresentation'>>;
  let store: jest.Mocked<Pick<Store, 'select'>>;

  beforeEach(() => {
    presentationsService = {
      updatePresentation: jest.fn(),
    };

    store = {
      select: jest.fn(),
    };

    store.select
      .mockReturnValueOnce(of('pres-1'))
      .mockReturnValueOnce(of('# hi'));

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$)],
    });

    actions$ = TestBed.inject(Actions);
  });

  it('should save markdown', (done) => {
    presentationsService.updatePresentation.mockReturnValue(
      of({ id: 'pres-1', title: 'Demo', markdown: '# hi', createdAt: '', updatedAt: '' }),
    );

    actions$ = of(saveEditor());

    saveEditor$(actions$ as Actions, store as Store, presentationsService as PresentationsService).subscribe((action) => {
      expect(action).toEqual(saveEditorSuccess({ markdown: '# hi' }));
      done();
    });
  });
});
