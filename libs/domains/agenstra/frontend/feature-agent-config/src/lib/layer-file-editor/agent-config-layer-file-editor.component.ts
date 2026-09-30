import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  OpencodeLayerFilesService,
  type OpencodeLayerFileDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { Observable, of } from 'rxjs';
import { catchError, take } from 'rxjs/operators';

/**
 * Modal editor for global/workspace layer files (no agentId).
 * Persists to controller DB and triggers fan-out emit to descendant agents.
 */
@Component({
  selector: 'agenstra-agent-config-layer-file-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcSpinnerComponent,
  ],
  template: `
    <div class="agent-config-layer-file-editor d-flex flex-column gap-3">
      @if (loading()) {
        <div class="d-flex justify-content-center py-4">
          <fpc-spinner />
        </div>
      } @else {
        @if (error(); as err) {
          <fpc-alert variant="danger">{{ err }}</fpc-alert>
        }
        <div class="small text-muted">
          <span i18n="@@featureAgentConfig-layerFilePathLabel">Path</span>:
          <code>{{ displayPath() }}</code>
        </div>
        <fpc-form-field forId="layerFileContent" i18n-label="@@featureAgentConfig-layerFileContent" label="Content">
          <fpc-form-control
            controlId="layerFileContent"
            controlType="textarea"
            [rows]="16"
            [ngModel]="content()"
            (ngModelChange)="content.set($event)"
          />
        </fpc-form-field>
        <div class="d-flex justify-content-end gap-2">
          <fpc-button variant="primary" [disabled]="saving()" (clicked)="save()" i18n="@@featureAgentConfig-save"
            >Save</fpc-button
          >
        </div>
      }
    </div>
  `,
})
export class AgentConfigLayerFileEditorComponent implements OnInit {
  private readonly layerFiles = inject(OpencodeLayerFilesService);

  readonly scope = input.required<'global' | 'workspace'>();
  readonly clientId = input<string | null>(null);
  readonly path = input.required<string>();

  readonly saved = output<{ emittedPath: string }>();
  readonly cancelled = output<void>();

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly content = signal('');
  readonly emittedPath = signal('');

  readonly displayPath = computed(() => this.emittedPath() || this.path());

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.error.set(null);
    const scope = this.scope();
    const path = this.path();
    const clientId = this.clientId();
    const request$: Observable<OpencodeLayerFileDto | null> =
      scope === 'global'
        ? this.layerFiles.getGlobal(path)
        : clientId
          ? this.layerFiles.getWorkspace(clientId, path)
          : of(null);

    request$
      .pipe(
        catchError(() => of(null)),
        take(1),
      )
      .subscribe((dto: OpencodeLayerFileDto | null) => {
        if (dto) {
          this.content.set(dto.content);
          this.emittedPath.set(dto.emittedPath);
        } else {
          this.content.set('');
          this.emittedPath.set(path);
        }

        this.loading.set(false);
      });
  }

  save(): void {
    const scope = this.scope();
    const path = this.path();
    const clientId = this.clientId();
    const body = this.content();

    this.saving.set(true);
    this.error.set(null);

    const request$ =
      scope === 'global'
        ? this.layerFiles.putGlobal(path, body)
        : clientId
          ? this.layerFiles.putWorkspace(clientId, path, body)
          : null;

    if (!request$) {
      this.error.set($localize`:@@featureAgentConfig-layerFileMissingClient:Workspace id is required`);
      this.saving.set(false);

      return;
    }

    request$.pipe(take(1)).subscribe({
      next: (dto) => {
        this.emittedPath.set(dto.emittedPath);
        this.saving.set(false);
        this.saved.emit({ emittedPath: dto.emittedPath });
      },
      error: (err: { message?: string }) => {
        this.error.set(err.message ?? $localize`:@@featureAgentConfig-layerFileSaveFailed:Failed to save file`);
        this.saving.set(false);
      },
    });
  }
}
