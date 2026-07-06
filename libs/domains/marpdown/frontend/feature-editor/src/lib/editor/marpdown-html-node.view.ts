import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import type { EditorView, NodeView } from '@milkdown/kit/prose/view';
import { htmlSchema } from '@milkdown/kit/preset/commonmark';
import { $view } from '@milkdown/kit/utils';
import * as monaco from 'monaco-editor';

import { createAutoHeightMonacoEmbed, type AutoHeightMonacoEmbed } from './marpdown-monaco-embed';

class MarpHtmlNodeView implements NodeView {
  dom: HTMLElement;
  private readonly monacoEmbed: AutoHeightMonacoEmbed;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private node: ProseNode;
  private isApplyingExternalValue = false;

  constructor(node: ProseNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;

    this.dom = document.createElement('div');
    this.dom.className = 'marpdown-html-node';
    this.dom.contentEditable = 'false';

    const label = document.createElement('span');
    label.className = 'marpdown-html-node__label';
    label.textContent = 'HTML / Marp directive';

    this.monacoEmbed = createAutoHeightMonacoEmbed(node.attrs['value'] ?? '', 'html');
    this.monacoEmbed.container.classList.add('marpdown-html-node__editor');

    this.monacoEmbed.editor.onDidChangeModelContent(() => {
      if (!this.isApplyingExternalValue) {
        this.commit();
      }
    });

    this.monacoEmbed.editor.addCommand(monaco.KeyCode.Escape, () => {
      this.monacoEmbed.editor.getDomNode()?.blur();
    });

    this.monacoEmbed.container.addEventListener('mousedown', (event) => event.stopPropagation());
    this.monacoEmbed.container.addEventListener('click', (event) => event.stopPropagation());

    this.dom.append(label, this.monacoEmbed.container);
  }

  update(node: ProseNode): boolean {
    if (node.type.name !== 'html') {
      return false;
    }

    this.node = node;

    const nextValue = node.attrs['value'] ?? '';

    if (!this.monacoEmbed.editor.hasTextFocus() && nextValue !== this.monacoEmbed.editor.getValue()) {
      this.isApplyingExternalValue = true;
      this.monacoEmbed.editor.setValue(nextValue);
      this.isApplyingExternalValue = false;
    }

    return true;
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode');
    this.monacoEmbed.editor.focus();
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode');
  }

  stopEvent(event: Event): boolean {
    const target = event.target;

    if (!(target instanceof globalThis.Node)) {
      return false;
    }

    return this.monacoEmbed.container.contains(target);
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.monacoEmbed.dispose();
  }

  private commit(): void {
    const pos = this.getPos();

    if (pos === undefined) {
      return;
    }

    const nextValue = this.monacoEmbed.editor.getValue();

    if (nextValue === this.node.attrs['value']) {
      return;
    }

    this.view.dispatch(this.view.state.tr.setNodeAttribute(pos, 'value', nextValue));
  }
}

export const marpdownHtmlNodeView = $view(htmlSchema.node, () => {
  return (node, view, getPos) => new MarpHtmlNodeView(node, view, getPos as () => number | undefined);
});
