import { listAssetDirectory, listAssetDirectorySuccess } from './assets.actions';
import { assetsReducer, initialAssetsState } from './assets.reducer';

describe('assetsReducer', () => {
  it('should cache directory listings', () => {
    let state = assetsReducer(initialAssetsState, listAssetDirectory({ presentationId: 'pres-1' }));

    state = assetsReducer(
      state,
      listAssetDirectorySuccess({
        presentationId: 'pres-1',
        directoryPath: '.',
        files: [{ name: 'logo.png', path: 'assets/logo.png', type: 'file' }],
      }),
    );

    expect(state.directoryListings['pres-1:.']).toHaveLength(1);
    expect(state.listing['pres-1:.']).toBe(false);
  });
});
