import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of } from 'rxjs';

import { PresentationAssetsService } from '../../services/presentation-assets.service';

import { listAssetDirectory, listAssetDirectorySuccess } from './assets.actions';
import { listAssetDirectory$ } from './assets.effects';

describe('assets effects', () => {
  let actions$: Observable<unknown>;
  let assetsService: jest.Mocked<Pick<PresentationAssetsService, 'listDirectory'>>;

  beforeEach(() => {
    assetsService = {
      listDirectory: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$)],
    });

    actions$ = TestBed.inject(Actions);
  });

  it('should list directory', (done) => {
    assetsService.listDirectory.mockReturnValue(of([{ name: 'a.png', path: 'assets/a.png', type: 'file' }]));

    actions$ = of(listAssetDirectory({ presentationId: 'pres-1' }));

    listAssetDirectory$(actions$ as Actions, assetsService as PresentationAssetsService).subscribe((action) => {
      expect(action).toEqual(
        listAssetDirectorySuccess({
          presentationId: 'pres-1',
          directoryPath: '.',
          files: [{ name: 'a.png', path: 'assets/a.png', type: 'file' }],
        }),
      );
      done();
    });
  });
});
