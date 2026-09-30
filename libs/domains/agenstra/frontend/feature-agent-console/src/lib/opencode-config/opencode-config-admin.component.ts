import { CommonModule } from '@angular/common';
import { Component, signal, viewChild } from '@angular/core';
import { AgentConfigEditorComponent } from '@forepath/agenstra/frontend/feature-agent-config';
import { FpcButtonComponent, FpcModalComponent, FpcPageHeaderComponent } from '@forepath/shared/frontend/ui-components';

import { LayerFileIdeComponent } from '../layer-file-ide/layer-file-ide.component';

@Component({
  selector: 'framework-agent-config-admin',
  standalone: true,
  imports: [
    CommonModule,
    FpcButtonComponent,
    FpcPageHeaderComponent,
    FpcModalComponent,
    AgentConfigEditorComponent,
    LayerFileIdeComponent,
  ],
  template: `
    <div class="agent-config-admin border-top d-flex flex-column">
      <fpc-page-header [title]="pageTitle">
        <fpc-button
          fpcPageHeaderActions
          variant="secondary"
          size="sm"
          iconOnly
          [disabled]="!editor() || (editor()?.loading() ?? true)"
          [title]="editor()?.modeToggleTitle() ?? modeToggleFallback"
          [ariaLabel]="editor()?.modeToggleTitle() ?? modeToggleFallback"
          (clicked)="onToggleMode()"
        >
          @if (editor()?.mode() === 'raw') {
            <i class="bi bi-sliders" aria-hidden="true"></i>
          } @else {
            <i class="bi bi-braces" aria-hidden="true"></i>
          }
        </fpc-button>
        <fpc-button
          fpcPageHeaderActions
          variant="primary"
          size="sm"
          iconOnly
          [loading]="editor()?.saving() ?? false"
          [disabled]="!(editor()?.canSave() ?? false)"
          i18n-ariaLabel="@@featureAgentConfig-save"
          ariaLabel="Save"
          i18n-title="@@featureAgentConfig-save"
          title="Save"
          (clicked)="onSave()"
        >
          <i class="bi bi-save" aria-hidden="true"></i>
        </fpc-button>
      </fpc-page-header>
      @if (editor()?.isDirty()) {
        <div class="agent-config-admin__drift bg-warning text-dark px-3 py-1 small">
          <i class="bi bi-exclamation-triangle-fill me-2" aria-hidden="true"></i>
          <span class="fw-bold" i18n="@@featureAgentConfig-unsavedChanges">Unsaved changes</span>
          <span i18n="@@featureAgentConfig-unsavedChangesHint">Closing without saving will discard your edits.</span>
        </div>
      }
      <div class="agent-config-admin__body p-3">
        <agenstra-agent-config-editor layer="global" presentation="page" (editPathFile)="onEditPathFile($event)" />
      </div>
    </div>
    @if (layerFileOpen() && layerFilePath(); as path) {
      <fpc-modal
        [(open)]="layerFileOpen"
        i18n-title="@@featureAgentConfig-layerFileEditorTitle"
        title="Edit layer file"
        size="xl"
        (closed)="closeLayerFile()"
      >
        <framework-layer-file-ide scope="global" [path]="path" (cancelled)="closeLayerFile()" />
      </fpc-modal>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        width: 100%;
        min-height: 0;
        overflow: hidden;
      }

      .agent-config-admin {
        flex: 1 1 0;
        min-height: 0;
        overflow: hidden;
      }

      .agent-config-admin > fpc-page-header {
        flex: 0 0 auto;
      }

      .agent-config-admin__drift {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.35rem 0.5rem;
      }

      .agent-config-admin__body {
        flex: 1 1 0;
        min-height: 0;
        overflow: auto;
      }
    `,
  ],
})
export class AgentConfigAdminComponent {
  readonly editor = viewChild(AgentConfigEditorComponent);

  readonly pageTitle = $localize`:@@featureAgentConsole-agentConfigTitle:Agent configuration`;
  readonly modeToggleFallback = $localize`:@@featureAgentConfig-switchToRaw:Switch to raw JSON`;
  readonly layerFileOpen = signal(false);
  readonly layerFilePath = signal<string | null>(null);

  onSave(): void {
    this.editor()?.onSave();
  }

  onToggleMode(): void {
    this.editor()?.toggleMode();
  }

  onEditPathFile(path: string): void {
    const trimmed = path.trim();

    if (!trimmed) {
      return;
    }

    this.layerFilePath.set(trimmed);
    this.layerFileOpen.set(true);
  }

  closeLayerFile(): void {
    this.layerFileOpen.set(false);
    this.layerFilePath.set(null);
  }
}
