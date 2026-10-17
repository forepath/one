import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type {
  DashboardWidget,
  DashboardWidgetState,
  FlowRow,
  LogLine,
  MetricSeries,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcEmptyStateComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';

import { formatBytes } from '../overview/console-format';
import { LOG_LEVEL_TONE } from '../logs/logs-format';
import { LoadweaverMetricChartComponent } from './metric-chart.component';
import { formatMetricValue, latestValues, metricUnit, statValue, type MetricChartType } from './metrics-format';

/** Pixel height of one grid row. */
export const DASHBOARD_ROW_PX = 64;

/** One widget of a dashboard: a chart, a stat, a table (flows or newest values) or log lines. */
@Component({
  selector: 'loadweaver-dashboard-widget',
  imports: [
    CommonModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcEmptyStateComponent,
    FpcSpinnerComponent,
    LoadweaverMetricChartComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  templateUrl: './dashboard-widget.component.html',
})
export class LoadweaverDashboardWidgetComponent {
  readonly widget = input.required<DashboardWidget>();
  readonly state = input<DashboardWidgetState | null>(null);

  readonly result = computed(() => this.state()?.result ?? null);
  readonly series = computed<MetricSeries[]>(() => {
    const result = this.result();

    return result?.kind === 'series' ? result.series : [];
  });
  readonly rows = computed<FlowRow[]>(() => {
    const result = this.result();

    return result?.kind === 'flows' ? result.rows : [];
  });
  readonly lines = computed<LogLine[]>(() => {
    const result = this.result();

    return result?.kind === 'logs' ? result.lines : [];
  });
  readonly unit = computed(() => {
    const widget = this.widget();

    return widget.unit ?? ('metrics' in widget.query ? metricUnit(widget.query.metrics.metric) : undefined);
  });
  readonly chartType = computed<MetricChartType | null>(() => {
    const type = this.widget().type;

    return type === 'line' || type === 'area' || type === 'bar' ? type : null;
  });
  /** Chart height: the widget's rows minus its header. */
  readonly chartHeight = computed(() => Math.max(120, (this.widget().h ?? 4) * DASHBOARD_ROW_PX - 56));
  readonly stat = computed(() => statValue(this.series()));
  readonly latest = computed(() => latestValues(this.series()));
  readonly empty = computed(() => {
    const result = this.result();

    if (!result) return false;

    return result.kind === 'series'
      ? result.series.length === 0
      : result.kind === 'flows'
        ? result.rows.length === 0
        : result.lines.length === 0;
  });

  readonly levelTone = LOG_LEVEL_TONE;
  readonly formatValue = formatMetricValue;
  readonly formatBytes = formatBytes;
}
