import type { Node } from '@milkdown/kit/prose/model';
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

function isEditableTextBlock(node: Node): boolean {
  return node.isTextblock && !node.isAtom;
}

function replaceTextBlockNodeSelection(view: EditorView): boolean {
  if (view.dom.dataset['dragging'] === 'true') {
    return false;
  }

  const { selection, doc } = view.state;

  if (!(selection instanceof NodeSelection)) {
    return false;
  }

  if (!isEditableTextBlock(selection.node)) {
    return false;
  }

  const anchor = Math.min(selection.from + 1, doc.content.size);
  const textSelection = TextSelection.near(doc.resolve(anchor), 1);

  view.dispatch(view.state.tr.setSelection(textSelection));
  view.focus();

  return true;
}

export const marpdownFocusTextSelectionPlugin = $prose(() => {
  return new Plugin({
    key: new PluginKey('marpdownFocusTextSelection'),
    props: {
      handleClick(view) {
        return replaceTextBlockNodeSelection(view);
      },
      handleDOMEvents: {
        mouseup(view) {
          return replaceTextBlockNodeSelection(view);
        },
      },
    },
  });
});
