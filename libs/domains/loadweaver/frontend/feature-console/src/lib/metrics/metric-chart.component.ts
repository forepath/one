import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { MetricEvent, MetricSeries } from '@forepath/loadweaver/frontend/data-access-console';
import { NgApexchartsModule } from 'ng-apexcharts';

import { metricChartOptions, type MetricChartType } from './metrics-format';

/** A time-series chart (ApexCharts with the shared chart theme). */
@Component({
  selector: 'loadweaver-metric-chart',
  imports: [NgApexchartsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  template: `
    @let o = options();
    <apx-chart
      [series]="$any(o.series)"
      [chart]="$any(o.chart)"
      [colors]="o.colors"
      [stroke]="o.stroke"
      [fill]="$any(o.fill)"
      [dataLabels]="o.dataLabels"
      [xaxis]="o.xaxis"
      [yaxis]="o.yaxis"
      [grid]="o.grid"
      [legend]="o.legend"
      [tooltip]="o.tooltip"
      [annotations]="$any(o.annotations)"
    ></apx-chart>
  `,
})
export class LoadweaverMetricChartComponent {
  readonly type = input<MetricChartType>('line');
  readonly series = input<readonly MetricSeries[]>([]);
  readonly unit = input<string | undefined>(undefined);
  readonly height = input(280);
  readonly events = input<readonly MetricEvent[]>([]);
  /** Readable series names (e.g. container states); default: the series key. */
  readonly seriesLabel = input<((key: string) => string) | undefined>(undefined);

  readonly options = computed(() =>
    metricChartOptions(this.type(), this.series(), {
      height: this.height(),
      unit: this.unit(),
      events: this.events(),
      seriesLabel: this.seriesLabel(),
    }),
  );
}
