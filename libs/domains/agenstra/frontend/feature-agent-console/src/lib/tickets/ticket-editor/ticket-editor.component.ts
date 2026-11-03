import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { Crepe } from '@milkdown/crepe';
import { listener, listenerCtx } from '@milkdown/plugin-listener';

@Component({
  selector: 'framework-ticket-editor',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ticket-editor.component.html',
  styleUrls: ['./ticket-editor.component.scss'],
})
export class TicketEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('editorHost', { static: true })
  private editorHost!: ElementRef<HTMLDivElement>;

  @Input() markdown = '# Hello\n\nStart writing...';
  /** Accessible name of the editable area (Milkdown's contenteditable root); a `label for` cannot target it. */
  @Input() ariaLabel: string | null = null;
  @Output() markdownChange = new EventEmitter<string>();
  @Output() blurred = new EventEmitter<void>();

  private readonly destroyRef = inject(DestroyRef);
  private crepe: Crepe | null = null;
  private viewReady = false;
  private lastEmittedMarkdown = '';

  async ngAfterViewInit(): Promise<void> {
    this.viewReady = true;
    await this.initEditor();
  }

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    if (changes['ariaLabel'] && this.crepe) {
      this.applyAriaLabel();
    }

    if (!this.viewReady || !this.crepe || !changes['markdown']) return;

    const nextValue = changes['markdown'].currentValue ?? '';

    if (nextValue === this.lastEmittedMarkdown) return;

    await this.recreateEditor(nextValue);
  }

  async ngOnDestroy(): Promise<void> {
    await this.destroyEditor();
  }

  private async initEditor(initialValue = this.markdown): Promise<void> {
    if (this.destroyRef.destroyed) return;

    const crepe = new Crepe({
      root: this.editorHost.nativeElement,
      defaultValue: initialValue,
    });

    crepe.editor.use(listener);
    crepe.editor.config((ctx) => {
      const listeners = ctx.get(listenerCtx);

      listeners.markdownUpdated((_, markdown, prevMarkdown) => {
        if (markdown !== prevMarkdown) {
          this.lastEmittedMarkdown = markdown;
          this.markdownChange.emit(markdown);
        }
      });
      listeners.blur(() => {
        this.blurred.emit();
      });
    });

    await crepe.create();

    if (this.destroyRef.destroyed) {
      await crepe.destroy();

      return;
    }

    this.crepe = crepe;
    this.lastEmittedMarkdown = initialValue;
    this.applyAriaLabel();
  }

  /** Names the editable element Crepe renders (ProseMirror keeps attributes it did not set itself). */
  private applyAriaLabel(): void {
    // The ProseMirror root, not nested `contenteditable="false"` widgets (code blocks, images).
    const editable = this.editorHost.nativeElement.querySelector<HTMLElement>('.ProseMirror[contenteditable]');

    if (!editable) return;

    if (this.ariaLabel) {
      editable.setAttribute('role', 'textbox');
      editable.setAttribute('aria-multiline', 'true');
      editable.setAttribute('aria-label', this.ariaLabel);
    } else {
      editable.removeAttribute('aria-label');
    }
  }

  private async recreateEditor(value: string): Promise<void> {
    await this.destroyEditor();
    await this.initEditor(value);
  }

  private async destroyEditor(): Promise<void> {
    if (!this.crepe) return;

    await this.crepe.destroy();
    this.crepe = null;
  }
}
