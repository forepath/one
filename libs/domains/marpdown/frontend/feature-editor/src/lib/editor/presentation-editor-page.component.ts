import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ViewChild, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  EditorFacade,
  PresentationExportService,
  PresentationsFacade,
  saveEditorSuccess,
} from '@forepath/marpdown/frontend/data-access-editor';
import { ExportFormat, GUEST_EDITOR_PRESENTATION_ID } from '@forepath/marpdown/marpdown/shared';
import { Actions, ofType } from '@ngrx/effects';
import { combineLatest, map, of, switchMap } from 'rxjs';

import { PresentationAssetTreeComponent } from './presentation-asset-tree.component';
import { PresentationEditorModeService } from './presentation-editor-mode.service';
import { PresentationMarkdownEditorComponent } from './presentation-markdown-editor.component';
import { PresentationMonacoEditorComponent } from './presentation-monaco-editor.component';
import { PresentationPreviewComponent } from './presentation-preview.component';
import { PresentationPresenterComponent } from './presentation-presenter.component';
import { PresentationToolbarComponent } from './presentation-toolbar.component';

@Component({
  selector: 'marpdown-presentation-editor-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    PresentationToolbarComponent,
    PresentationAssetTreeComponent,
    PresentationMonacoEditorComponent,
    PresentationMarkdownEditorComponent,
    PresentationPreviewComponent,
    PresentationPresenterComponent,
  ],
  templateUrl: './presentation-editor-page.component.html',
  styleUrls: ['./presentation-editor-page.component.scss'],
})
export class PresentationEditorPageComponent implements OnInit {
  protected readonly ExportFormat = ExportFormat;

  @ViewChild(PresentationMonacoEditorComponent)
  private monacoEditor?: PresentationMonacoEditorComponent;

  @ViewChild(PresentationMarkdownEditorComponent)
  private milkdownEditor?: PresentationMarkdownEditorComponent;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly editorModeService = inject(PresentationEditorModeService);
  private readonly presentationsFacade = inject(PresentationsFacade);
  private readonly editorFacade = inject(EditorFacade);
  private readonly exportService = inject(PresentationExportService);
  private readonly actions$ = inject(Actions);
  private readonly destroyRef = inject(DestroyRef);

  presentationId = '';
  guestMode = false;
  exporting = false;
  presenterOpen = false;
  presenterMarkdown = '';
  currentMarkdown = '';

  readonly title$ = this.route.data.pipe(
    switchMap((data) => {
      if (data['guestMode'] === true) {
        return of('Untitled deck');
      }

      return combineLatest([
        this.route.paramMap.pipe(
          switchMap((params) => this.presentationsFacade.getPresentationById$(params.get('id') ?? '')),
        ),
        this.presentationsFacade.selectedPresentation$,
      ]).pipe(map(([summary, selected]) => selected?.title ?? summary?.title ?? 'Presentation'));
    }),
  );

  readonly markdown$ = this.editorFacade.markdown$;
  readonly isDirty$ = this.editorFacade.isDirty$;
  readonly saving$ = this.editorFacade.saving$;
  readonly importing$ = this.editorFacade.importing$;
  readonly editorMode = this.editorModeService.mode;

  ngOnInit(): void {
    this.guestMode = this.route.snapshot.data['guestMode'] === true;

    this.markdown$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((markdown) => {
      this.currentMarkdown = markdown;
    });

    if (this.guestMode) {
      this.presentationId = GUEST_EDITOR_PRESENTATION_ID;
      this.editorFacade.openEditor(this.presentationId);

      return;
    }

    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id');

      if (!id) {
        void this.router.navigate(['/presentations']);

        return;
      }

      this.presentationId = id;
      this.presentationsFacade.setActivePresentation(id);
      this.editorFacade.openEditor(id);
      this.presentationsFacade.loadPresentation(id);
    });

    this.actions$
      .pipe(ofType(saveEditorSuccess), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.presentationsFacade.loadPresentation(this.presentationId));
  }

  onMarkdownChange(markdown: string): void {
    this.editorFacade.setMarkdown(markdown);
  }

  save(): void {
    this.editorFacade.save();
  }

  importMarkdown(): void {
    const input = document.createElement('input');

    input.type = 'file';
    input.accept = '.md,text/markdown,text/plain';

    input.onchange = () => {
      const file = input.files?.[0];

      if (!file) {
        return;
      }

      void file.text().then((markdown) => {
        if (this.guestMode) {
          this.editorFacade.resetMarkdown(markdown);

          return;
        }

        this.editorFacade.importMarkdown(markdown);
      });
    };

    input.click();
  }

  export(format: ExportFormat): void {
    if (!this.presentationId || this.guestMode) {
      return;
    }

    this.exporting = true;

    this.exportService.exportPresentation(this.presentationId, format).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');

        anchor.href = url;
        anchor.download = `presentation.${format}`;
        anchor.click();
        URL.revokeObjectURL(url);
        this.exporting = false;
      },
      error: () => {
        this.exporting = false;
      },
    });
  }

  undo(): void {
    if (this.editorMode() === 'monaco') {
      this.monacoEditor?.undo();

      return;
    }

    void this.milkdownEditor?.undo();
  }

  redo(): void {
    if (this.editorMode() === 'monaco') {
      this.monacoEditor?.redo();

      return;
    }

    void this.milkdownEditor?.redo();
  }

  startPresenter(): void {
    this.presenterMarkdown = this.currentMarkdown;
    this.presenterOpen = true;
  }

  closePresenter(): void {
    this.presenterOpen = false;
    this.presenterMarkdown = '';
  }
}
