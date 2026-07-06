import {
  loadPresentations,
  loadPresentationsBatch,
  loadPresentationsFailure,
  loadPresentationsSuccess,
} from './presentations.actions';
import { initialPresentationsState, presentationsReducer } from './presentations.reducer';

describe('presentationsReducer', () => {
  const summary = {
    id: 'pres-1',
    title: 'Demo',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
  };

  it('should return initial state', () => {
    expect(presentationsReducer(undefined, { type: 'UNKNOWN' } as never)).toEqual(initialPresentationsState);
  });

  it('should set loading on loadPresentations', () => {
    const state = presentationsReducer(initialPresentationsState, loadPresentations({}));

    expect(state.loading).toBe(true);
    expect(state.error).toBeNull();
  });

  it('should store batch results while loading', () => {
    const state = presentationsReducer(
      initialPresentationsState,
      loadPresentationsBatch({ offset: 10, accumulatedPresentations: [summary], total: 2 }),
    );

    expect(state.entities).toEqual([summary]);
    expect(state.total).toBe(2);
    expect(state.loading).toBe(true);
  });

  it('should complete loadPresentationsSuccess', () => {
    const state = presentationsReducer(
      { ...initialPresentationsState, loading: true },
      loadPresentationsSuccess({ presentations: [summary], total: 1 }),
    );

    expect(state.loading).toBe(false);
    expect(state.entities).toEqual([summary]);
  });

  it('should store loadPresentationsFailure', () => {
    const state = presentationsReducer(
      { ...initialPresentationsState, loading: true },
      loadPresentationsFailure({ error: 'failed' }),
    );

    expect(state.loading).toBe(false);
    expect(state.error).toBe('failed');
  });
});
