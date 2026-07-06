import { selectEditorIsDirty, selectEditorMarkdown } from './editor.selectors';
import { initialEditorState } from './editor.reducer';

describe('editor selectors', () => {
  const state = {
    editor: {
      ...initialEditorState,
      markdown: 'draft',
      savedMarkdown: 'saved',
    },
  };

  it('should select markdown', () => {
    expect(selectEditorMarkdown(state)).toBe('draft');
  });

  it('should detect dirty state', () => {
    expect(selectEditorIsDirty(state)).toBe(true);
  });
});
