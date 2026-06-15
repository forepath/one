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
  selector: 'framework-knowledge-editor',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './knowledge-editor.component.html',
  styleUrls: ['./knowledge-editor.component.scss'],
})
export class KnowledgeEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('editorHost', { static: true })
  private editorHost!: ElementRef<HTMLDivElement>;

  @Input() markdown = '';
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
