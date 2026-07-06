import { selectPresentationById, selectPresentations, selectPresentationsLoading } from './presentations.selectors';
import { initialPresentationsState } from './presentations.reducer';

describe('presentations selectors', () => {
  const state = {
    presentations: {
      ...initialPresentationsState,
      entities: [{ id: '1', title: 'A', createdAt: '', updatedAt: '' }],
      loading: true,
    },
  };

  it('should select presentations', () => {
    expect(selectPresentations(state)).toHaveLength(1);
  });

  it('should select loading flag', () => {
    expect(selectPresentationsLoading(state)).toBe(true);
  });

  it('should select presentation by id', () => {
    expect(selectPresentationById('1')(state)?.title).toBe('A');
  });
});
