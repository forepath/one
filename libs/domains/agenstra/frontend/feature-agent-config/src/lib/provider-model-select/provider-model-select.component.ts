import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  formatProviderModelRef,
  getBuiltinProvider,
  parseProviderModelRef,
  type OpencodeBuiltinProvider,
} from '@forepath/agenstra/shared/util-opencode-providers';
import { FpcFormControlComponent } from '@forepath/shared/frontend/ui-components';

/**
 * Provider + model picker for a `provider/model` field (2026-10-29): the default-model pattern of the config editor
 * (provider select, then the provider's catalog models, or a model id input when the catalog lists none), reusable
 * for the per-entry model fields (commands, agents). Falls back to free text when the catalog is empty or the stored
 * provider isn't in it, so no value is ever lost.
 */
@Component({
  selector: 'agenstra-provider-model-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, FpcFormControlComponent],
  host: { class: 'agenstra-provider-model-select d-block' },
  styles: `
    .agenstra-provider-model-select__row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
      gap: 0.5rem;
      align-items: stretch;

      @media (max-width: 40rem) {
        grid-template-columns: 1fr;
      }
    }
  `,
  template: `
    @if (usesPicker()) {
      <div class="agenstra-provider-model-select__row" data-testid="provider-model-picker">
        <fpc-form-control
          [controlId]="inputId() + '-provider'"
          controlType="select"
          [ngModel]="draftProviderId()"
          (ngModelChange)="onProviderChange($event)"
          [disabled]="disabled()"
          [ariaLabel]="providerLabel"
        >
          <option value="">{{ providerLabel }}</option>
          @for (provider of providerOptions(); track provider.id) {
            <option [value]="provider.id">{{ provider.name }} ({{ provider.id }})</option>
          }
        </fpc-form-control>
        @if (modelOptions().length > 0) {
          <fpc-form-control
            [controlId]="inputId()"
            controlType="select"
            [ngModel]="draftModelId()"
            (ngModelChange)="onModelChange($event)"
            [disabled]="disabled() || !draftProviderId().trim()"
            [ariaLabel]="modelLabel"
          >
            <option value="">{{ modelLabel }}</option>
            @for (model of modelOptions(); track model.id) {
              <option [value]="model.id">
                {{ model.name === model.id ? model.id : model.name + ' (' + model.id + ')' }}
              </option>
            }
          </fpc-form-control>
        } @else {
          <fpc-form-control
            [controlId]="inputId()"
            [ngModel]="draftModelId()"
            (ngModelChange)="onModelChange($event)"
            [disabled]="disabled() || !draftProviderId().trim()"
            placeholder="model-id"
            [ariaLabel]="modelLabel"
          />
        }
      </div>
    } @else {
      <fpc-form-control
        [controlId]="inputId()"
        [ngModel]="value()"
        (ngModelChange)="valueChange.emit($event)"
        [disabled]="disabled()"
        placeholder="provider/model"
        data-testid="provider-model-text"
      />
    }
  `,
})
export class ProviderModelSelectComponent {
  readonly value = input<string>('');
  /** The provider catalog the editor already holds (scoped to the enabled / disabled providers by the caller). */
  readonly providers = input<readonly OpencodeBuiltinProvider[]>([]);
  readonly disabled = input(false);
  readonly inputId = input('agenstraProviderModel');

  readonly valueChange = output<string>();

  readonly providerLabel = $localize`:@@featureAgentConfig-knownModelProviderPlaceholder:Provider`;
  readonly modelLabel = $localize`:@@featureAgentConfig-knownModelPlaceholder:Model`;

  readonly draftProviderId = signal('');
  readonly draftModelId = signal('');

  readonly providerOptions = computed(() => [...this.providers()]);
  readonly modelOptions = computed(
    () => getBuiltinProvider([...this.providers()], this.draftProviderId())?.models ?? [],
  );
  readonly usesPicker = computed(() => {
    const catalog = this.providers();

    if (catalog.length === 0) {
      return false;
    }

    const draftId = this.draftProviderId().trim();

    return !draftId || !!getBuiltinProvider([...catalog], draftId);
  });

  constructor() {
    // The stored value drives the drafts (a provider picked without a model yet stays a draft).
    effect(() => {
      const parsed = parseProviderModelRef(this.value() ?? '');

      untracked(() => {
        if (!parsed && this.draftProviderId() && !this.value()) {
          return;
        }

        this.draftProviderId.set(parsed?.providerId ?? (this.value() ? this.value() : ''));
        this.draftModelId.set(parsed?.modelId ?? '');
      });
    });
  }

  onProviderChange(providerId: string): void {
    this.draftProviderId.set(providerId);
    this.draftModelId.set('');
    this.valueChange.emit('');
  }

  onModelChange(modelId: string): void {
    this.draftModelId.set(modelId);
    const provider = this.draftProviderId().trim();
    const model = modelId.trim();

    this.valueChange.emit(provider && model ? formatProviderModelRef(provider, model) : '');
  }
}
