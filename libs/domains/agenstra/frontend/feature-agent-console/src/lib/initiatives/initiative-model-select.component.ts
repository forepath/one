import { Component, computed, effect, inject, input, output, untracked } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { AgentsFacade, type AgentModelsMap } from '@forepath/agenstra/frontend/data-access-agent-console';
import { FpcFormControlComponent } from '@forepath/shared/frontend/ui-components';
import { combineLatest, of, switchMap } from 'rxjs';

/**
 * Model of an environment, chosen from its catalog like on the tasks / tickets pages (no free-text typos). A current
 * value that is not in the catalog stays selectable (nothing is lost silently); `allowDefault` adds "Default model"
 * (empty value: the initiative's model, else the environment's). Without a catalog (environment unreachable, no models) it falls back to `provider/model`
 * text, as the tasks editor does.
 */
@Component({
  selector: 'framework-initiative-model-select',
  standalone: true,
  imports: [FormsModule, FpcFormControlComponent],
  template: `
    @if (options().length > 0 || loading()) {
      <fpc-form-control
        controlType="select"
        [controlId]="controlId()"
        [disabled]="disabled() || loading()"
        [ngModel]="value()"
        (ngModelChange)="valueChange.emit($event ?? '')"
      >
        @if (loading()) {
          <option [value]="value()" i18n="@@featureInitiatives-modelLoading">Loading models…</option>
        } @else {
          @if (allowDefault()) {
            <option value="" i18n="@@featureInitiatives-modelDefault">Default model</option>
          }
          @if (value() && !known()) {
            <option [value]="value()">{{ value() }}</option>
          }
          @for (option of options(); track option.id) {
            <option [value]="option.id">{{ option.name }}</option>
          }
        }
      </fpc-form-control>
    } @else {
      <fpc-form-control
        [controlId]="controlId()"
        controlClass="font-monospace"
        placeholder="provider/model"
        maxLength="256"
        [disabled]="disabled()"
        [ngModel]="value()"
        (ngModelChange)="valueChange.emit($event ?? '')"
      />
    }
  `,
})
export class InitiativeModelSelectComponent {
  readonly clientId = input<string | null>(null);
  /** Environment whose catalog is offered. */
  readonly agentId = input<string | null>(null);
  readonly controlId = input.required<string>();
  readonly value = input('');
  /** Offer "Default model" (empty value) for optional fields. */
  readonly allowDefault = input(true);
  readonly disabled = input(false);
  readonly valueChange = output<string>();

  private readonly agentsFacade = inject(AgentsFacade);
  private readonly target = computed(() => ({ clientId: this.clientId(), agentId: this.agentId() }));

  private readonly models = toSignal(
    toObservable(this.target).pipe(
      switchMap(({ clientId, agentId }) =>
        clientId && agentId
          ? combineLatest([
              this.agentsFacade.getClientAgentModels$(clientId, agentId),
              this.agentsFacade.getClientAgentModelsLoading$(clientId, agentId),
            ])
          : of([null, false] as [AgentModelsMap | null, boolean]),
      ),
    ),
    { initialValue: [null, false] as [AgentModelsMap | null, boolean] },
  );

  readonly loading = computed(() => this.models()[1] && !this.models()[0]);
  readonly options = computed(() =>
    Object.entries(this.models()[0] ?? {})
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  readonly known = computed(() => !!this.models()[0]?.[this.value()]);

  constructor() {
    effect(() => {
      const { clientId, agentId } = this.target();

      if (clientId && agentId) {
        untracked(() => this.agentsFacade.loadClientAgentModels(clientId, agentId));
      }
    });
  }
}
