import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import {
  PROJECT_ESTIMATOR_DEBUG_PRESETS,
  type ProjectEstimatorDebugPreset,
} from '@forepath/forepath/frontend/data-access-project-estimator';
import { FpcButtonComponent } from '@forepath/shared/frontend/ui-components';

@Component({
  selector: 'framework-forepath-project-estimate-debug-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcButtonComponent],
  styles: [
    `
      .estimate-debug-panel {
        margin-bottom: 1rem;
        padding: 0.75rem 1rem;
        border: 1px dashed var(--bs-warning);
        border-radius: 0.75rem;
        background: rgba(255, 193, 7, 0.08);
      }

      .estimate-debug-panel__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
    `,
  ],
  template: `
    <aside class="estimate-debug-panel rounded-3" aria-label="Temporary estimator state debug controls">
      <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
        <div>
          <p class="small fw-semibold text-warning-emphasis mb-0">Temp debug: force estimator UI state</p>
          <p class="small text-muted mb-0">Bypasses the local LLM. Remove before production release.</p>
        </div>
        <fpc-button type="button" size="sm" variant="outline-secondary" (clicked)="runInitialize.emit()">
          Run real init
        </fpc-button>
      </div>

      <div class="estimate-debug-panel__actions">
        @for (option of presets; track option.preset) {
          <fpc-button
            type="button"
            size="sm"
            [variant]="activePreset() === option.preset ? 'dark' : 'outline-dark'"
            [title]="option.description"
            (clicked)="presetSelected.emit(option.preset)"
          >
            {{ option.label }}
          </fpc-button>
        }
      </div>
    </aside>
  `,
})
export class ForepathProjectEstimateDebugPanelComponent {
  readonly presets = PROJECT_ESTIMATOR_DEBUG_PRESETS;
  readonly activePreset = input<ProjectEstimatorDebugPreset | null>(null);
  readonly presetSelected = output<ProjectEstimatorDebugPreset>();
  readonly runInitialize = output<void>();
}
