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
import { Crepe, CrepeFeature } from '@milkdown/crepe';
import { commandsCtx } from '@milkdown/kit/core';
import { history, redoCommand, undoCommand } from '@milkdown/plugin-history';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { addBlockTypeCommand, hrSchema } from '@milkdown/kit/preset/commonmark';
import { callCommand } from '@milkdown/utils';

import {
  countMarpSlides,
  defaultMarpFrontmatter,
  joinMarpMarkdown,
  splitMarpMarkdown,
} from './marp-markdown.utils';
import { marpdownFocusTextSelectionPlugin } from './marpdown-text-selection.plugin';
import { marpdownHtmlNodeView } from './marpdown-html-node.view';
import { configureMarpBlockMenu } from './marpdown-block-menu';

@Component({
  selector: 'marpdown-presentation-markdown-editor',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './presentation-markdown-editor.component.html',
  styleUrls: ['./presentation-markdown-editor.component.scss'],
})
export class PresentationMarkdownEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('editorHost', { static: true })
  private editorHost!: ElementRef<HTMLDivElement>;

  @Input() markdown = '';
  @Output() markdownChange = new EventEmitter<string>();

  protected frontmatter: string | null = null;
  protected slideCount = 1;

  private readonly destroyRef = inject(DestroyRef);
  private crepe: Crepe | null = null;
  private viewReady = false;
  private lastEmittedMarkdown = '';
  private bodyMarkdown = '';

  async ngAfterViewInit(): Promise<void> {
    this.viewReady = true;
    this.applyMarkdownParts(this.markdown);
    await this.initEditor(this.bodyMarkdown);
  }

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    if (!this.viewReady || !this.crepe || !changes['markdown']) {
      return;
    }

    const nextValue = changes['markdown'].currentValue ?? '';

    if (nextValue === this.lastEmittedMarkdown) {
      return;
    }

    this.applyMarkdownParts(nextValue);
    await this.recreateEditor(this.bodyMarkdown);
  }

  async ngOnDestroy(): Promise<void> {
    await this.destroyEditor();
  }

  async undo(): Promise<void> {
    await this.crepe?.editor.action(callCommand(undoCommand.key));
  }

  async redo(): Promise<void> {
    await this.crepe?.editor.action(callCommand(redoCommand.key));
  }

  async insertSlideBreak(): Promise<void> {
    await this.crepe?.editor.action((ctx) => {
      const commands = ctx.get(commandsCtx);
      const hr = hrSchema.type(ctx);

      commands.call(addBlockTypeCommand.key, { nodeType: hr });
    });
  }

  protected onFrontmatterInput(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;

    this.frontmatter = value;
    this.emitMarkdown(this.bodyMarkdown);
  }

  protected addDefaultFrontmatter(): void {
    this.frontmatter = defaultMarpFrontmatter();
    this.emitMarkdown(this.bodyMarkdown);
  }

  private applyMarkdownParts(markdown: string): void {
    const parts = splitMarpMarkdown(markdown);

    this.frontmatter = parts.frontmatter;
    this.bodyMarkdown = parts.body;
    this.slideCount = countMarpSlides(parts.body);
  }

  private emitMarkdown(body: string): void {
    const markdown = joinMarpMarkdown({
      frontmatter: this.frontmatter,
      body,
    });

    this.lastEmittedMarkdown = markdown;
    this.bodyMarkdown = body;
    this.slideCount = countMarpSlides(body);
    this.markdownChange.emit(markdown);
  }

  private async initEditor(initialValue: string): Promise<void> {
    if (this.destroyRef.destroyed) {
      return;
    }

    const crepe = new Crepe({
      root: this.editorHost.nativeElement,
      defaultValue: initialValue,
      features: {
        [CrepeFeature.TopBar]: true,
      },
      featureConfigs: {
        [CrepeFeature.Cursor]: {
          virtual: false,
        },
        [CrepeFeature.BlockEdit]: {
          textGroup: {
            divider: {
              label: 'Slide break',
            },
          },
          blockHandle: {
            getOffset: () => 4,
          },
          buildMenu: configureMarpBlockMenu,
        },
        [CrepeFeature.Placeholder]: {
          text: 'Write slide content. Type / for blocks, including Marp directives and slide breaks.',
        },
      },
    });

    crepe.editor.use(listener).use(history).use(marpdownFocusTextSelectionPlugin).use(marpdownHtmlNodeView);

    crepe.editor.config((ctx) => {
      const listeners = ctx.get(listenerCtx);

      listeners.markdownUpdated((_, markdown, prevMarkdown) => {
        if (markdown !== prevMarkdown) {
          this.emitMarkdown(markdown);
        }
      });
    });

    await crepe.create();

    if (this.destroyRef.destroyed) {
      await crepe.destroy();

      return;
    }

    this.crepe = crepe;
    this.lastEmittedMarkdown = joinMarpMarkdown({
      frontmatter: this.frontmatter,
      body: initialValue,
    });
  }

  private async recreateEditor(value: string): Promise<void> {
    await this.destroyEditor();
    await this.initEditor(value);
  }

  private async destroyEditor(): Promise<void> {
    if (!this.crepe) {
      return;
    }

    await this.crepe.destroy();
    this.crepe = null;
  }
}
