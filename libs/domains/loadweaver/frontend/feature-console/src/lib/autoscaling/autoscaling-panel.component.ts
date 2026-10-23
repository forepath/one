import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import {
  apiErrorMessage,
  AutoscalingService,
  type AutoscaledService,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';

import {
  autoscaledOf,
  autoscaleActionLabel,
  autoscaleMetricName,
  autoscaleTarget,
  autoscaleTone,
  autoscaleValue,
} from './autoscaling-format';

/**
 * Autoscaling status (3.23) of a deployment's (or one service's) autoscaled services: replicas within min..max,
 * metric vs. target, the last scaling with its reason, and why a scale-up is blocked. Renders nothing for
 * deployments without autoscaled services.
 */
@Component({
  selector: 'loadweaver-autoscaling-panel',
  imports: [
    CommonModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './autoscaling-panel.component.html',
  standalone: true,
})
export class LoadweaverAutoscalingPanelComponent {
  private readonly service = inject(AutoscalingService);

  readonly project = input.required<string>();
  readonly deployment = input<string | null>(null);
  readonly serviceName = input<string | null>(null);

  readonly all = signal<AutoscaledService[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly services = computed(() => autoscaledOf(this.all(), this.deployment(), this.serviceName()));

  readonly title = $localize`:@@lwConsoleAutoscaling-title:Autoscaling`;
  readonly loadError = $localize`:@@lwConsoleAutoscaling-loadError:The autoscaling status could not be loaded.`;
  readonly metricName = autoscaleMetricName;
  readonly target = autoscaleTarget;
  readonly value = autoscaleValue;
  readonly tone = autoscaleTone;
  readonly actionLabel = autoscaleActionLabel;

  constructor() {
    effect(() => this.load(this.project()));
  }

  load(project: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.list(project).subscribe({
      next: (list) => {
        this.all.set(list);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(apiErrorMessage(error, this.loadError));
        this.loading.set(false);
      },
    });
  }
}
