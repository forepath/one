import { openEditor, setEditorMarkdown } from './editor.actions';
import { editorReducer, initialEditorState } from './editor.reducer';

describe('editorReducer', () => {
  it('should track dirty state via markdown changes', () => {
    let state = editorReducer(initialEditorState, openEditor({ presentationId: 'pres-1' }));

    state = editorReducer(state, setEditorMarkdown({ markdown: 'hello' }));

    expect(state.presentationId).toBe('pres-1');
    expect(state.markdown).toBe('hello');
    expect(state.savedMarkdown).toBe('');
  });
});
