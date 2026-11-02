import { CommonModule } from '@angular/common';
import { booleanAttribute, Component, computed, effect, inject, input, signal } from '@angular/core';
import {
  apiErrorMessage,
  AutoscalingService,
  type AutoscaledService,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  type FpcBadgeTone,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcListHeaderComponent,
  FpcSectionRowComponent,
  FpcTableCellDirective,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import { LoadweaverLaneComponent } from '../section/lane.component';

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
 * deployments without autoscaled services, unless `lane` (the object page's Autoscaling tab, 3.38: one lane with an
 * empty state).
 */
@Component({
  selector: 'loadweaver-autoscaling-panel',
  imports: [
    CommonModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcListHeaderComponent,
    FpcSectionRowComponent,
    FpcTableCellDirective,
    LoadweaverLaneComponent,
  ],
  templateUrl: './autoscaling-panel.component.html',
  standalone: true,
})
export class LoadweaverAutoscalingPanelComponent {
  private readonly service = inject(AutoscalingService);

  readonly project = input.required<string>();
  readonly deployment = input<string | null>(null);
  readonly serviceName = input<string | null>(null);
  /** Render as the "Autoscaling" lane of an object tab (fills the body; empty state when nothing autoscales). */
  readonly lane = input(false, { transform: booleanAttribute });

  readonly all = signal<AutoscaledService[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly services = computed(() => autoscaledOf(this.all(), this.deployment(), this.serviceName()));

  readonly title = $localize`:@@lwConsoleAutoscaling-title:Autoscaling`;
  readonly loadError = $localize`:@@lwConsoleAutoscaling-loadError:The autoscaling status could not be loaded.`;
  readonly loadingLabel = $localize`:@@lwConsoleAutoscaling-loading:Loading the autoscaling status`;
  readonly emptyLabel = $localize`:@@lwConsoleAutoscaling-empty:No service of this deployment autoscales`;
  readonly metricName = autoscaleMetricName;
  readonly target = autoscaleTarget;
  readonly value = autoscaleValue;
  readonly tone = autoscaleTone;
  /** Scaling state as a tone badge (3.38 R10). */
  readonly badgeTone = (s: AutoscaledService): FpcBadgeTone => {
    const tone = autoscaleTone(s);

    return tone === 'secondary' ? 'neutral' : tone;
  };
  /** 3.38 D1: State (scaling action) · Service · replicas · metric · last evaluation · last scaling. */
  readonly columns: FpcTableColumn<AutoscaledService>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleAutoscaling-colState:State`,
      type: 'state',
      state: (s) => ({ label: autoscaleActionLabel(s), tone: this.badgeTone(s) }),
    },
    {
      id: 'service',
      label: $localize`:@@lwConsoleAutoscaling-colService:Service`,
      value: (s) => s.service,
      required: true,
      priority: 1,
    },
    {
      id: 'replicas',
      label: $localize`:@@lwConsoleAutoscaling-colReplicas:Replicas`,
      value: (s) => s.replicas,
      priority: 1,
    },
    { id: 'metric', label: $localize`:@@lwConsoleAutoscaling-metric:Metric`, priority: 2 },
    { id: 'evaluation', label: $localize`:@@lwConsoleAutoscaling-lastEvaluation:Last evaluation`, priority: 3 },
    {
      id: 'lastScale',
      label: $localize`:@@lwConsoleAutoscaling-lastScale:Last scaling`,
      value: (s) => s.lastScaleAt ?? '',
      priority: 2,
    },
  ];
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
