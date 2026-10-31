/**
 * Jest stand-in for `ngx-monaco-editor-v2` (its AMD loader can't run under jsdom): use it as
 * `jest.mock('ngx-monaco-editor-v2', () => jest.requireActual('../resources/monaco-stub'))`.
 * The code editor still validates and emits diagnostics without a live editor.
 */
import { Component, EventEmitter, Input, Output } from '@angular/core';

// Mirrors the third-party selector / output names on purpose.
// eslint-disable-next-line @angular-eslint/component-selector
@Component({ selector: 'ngx-monaco-editor', standalone: true, template: '' })
export class MonacoEditorStubComponent {
  @Input() options: unknown;
  // eslint-disable-next-line @angular-eslint/no-output-on-prefix
  @Output() readonly onInit = new EventEmitter<unknown>();
}

export const MonacoEditorModule = MonacoEditorStubComponent;

export function provideMonacoEditor(): never[] {
  return [];
}
