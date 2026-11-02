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
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcKeyValueListComponent,
  FpcPanelComponent,
  FpcSpinnerComponent,
  FpcTableCellDirective,
  type FpcBadgeTone,
  type FpcKeyValueItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import { formatBytes } from '../overview/console-format';
import { LOG_LEVEL_TONE, logLevelLabel } from '../logs/logs-format';
import { LoadweaverMetricChartComponent } from './metric-chart.component';
import {
  flowDecisionLabel,
  formatMetricValue,
  latestValues,
  metricUnit,
  statValue,
  type MetricChartType,
} from './metrics-format';

const FLOW_TONE: Record<string, FpcBadgeTone> = { allowed: 'success', denied: 'danger', observed: 'warning' };
const FLOW_ICON: Record<string, string> = { allowed: 'check-circle-fill', denied: 'slash-circle', observed: 'eye' };

/** Pixel height of one grid row. */
export const DASHBOARD_ROW_PX = 64;

/** One widget of a dashboard: a chart, a stat, a table (flows or newest values) or log lines. */
@Component({
  selector: 'loadweaver-dashboard-widget',
  imports: [
    CommonModule,
    FpcAlertComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcKeyValueListComponent,
    FpcPanelComponent,
    FpcSpinnerComponent,
    FpcTableCellDirective,
    LoadweaverMetricChartComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  templateUrl: './dashboard-widget.component.html',
  // A cell of the page's `fpc-panel-grid` (shared hairlines, no own frame). Placement on the 12-column grid
  // (`--lw-widget-column` / `-row`) applies from lg; below, each widget is a full row of its own height.
  host: { class: 'fpc-panel-grid__cell' },
  styles: `
    :host {
      display: block;
      min-width: 0;
      height: var(--lw-widget-height, auto);
    }

    @media (min-width: 992px) {
      :host {
        grid-column: var(--lw-widget-column, auto);
        grid-row: var(--lw-widget-row, auto);
        height: auto;
      }
    }
  `,
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
  /** Newest value per series as facts (`table` widgets over metrics). */
  readonly latestItems = computed<FpcKeyValueItem[]>(() =>
    this.latest().map((row) => ({ key: row.key, label: row.key, value: formatMetricValue(row.value, this.unit()) })),
  );
  readonly empty = computed(() => {
    const result = this.result();

    if (!result) return false;

    return result.kind === 'series'
      ? result.series.length === 0
      : result.kind === 'flows'
        ? result.rows.length === 0
        : result.lines.length === 0;
  });

  readonly flowColumns: FpcTableColumn<FlowRow>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleDashboards-colDecision:Decision`,
      type: 'state',
      value: (row) => flowDecisionLabel(row.decision),
      state: (row) => ({
        label: flowDecisionLabel(row.decision),
        tone: FLOW_TONE[row.decision] ?? 'neutral',
        icon: FLOW_ICON[row.decision],
      }),
    },
    {
      id: 'src',
      label: $localize`:@@lwConsoleDashboards-colSource:Source`,
      value: (row) => row.src,
      mono: true,
      required: true,
      priority: 1,
    },
    {
      id: 'dst',
      label: $localize`:@@lwConsoleDashboards-colDestination:Destination`,
      value: (row) => row.dst,
      mono: true,
      priority: 1,
    },
    {
      id: 'port',
      label: $localize`:@@lwConsoleDashboards-colPort:Port`,
      value: (row) => `${row.protocol}/${row.port}`,
      mono: true,
    },
    {
      id: 'policy',
      label: $localize`:@@lwConsoleDashboards-colPolicy:Policy`,
      value: (row) => row.policy,
      priority: 3,
    },
    {
      id: 'packets',
      label: $localize`:@@lwConsoleDashboards-colPackets:Packets`,
      value: (row) => row.packets.toLocaleString(),
      align: 'end',
    },
    {
      id: 'bytes',
      label: $localize`:@@lwConsoleDashboards-colBytes:Bytes`,
      value: (row) => formatBytes(row.bytes),
      align: 'end',
    },
  ];
  readonly logColumns: FpcTableColumn<LogLine>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleDashboards-colLevel:Level`,
      type: 'state',
      value: (line) => logLevelLabel(line.level),
      state: (line) => ({ label: logLevelLabel(line.level), tone: LOG_LEVEL_TONE[line.level] }),
    },
    {
      id: 'at',
      label: $localize`:@@lwConsoleDashboards-colTime:Time`,
      value: (line) => line.at,
      required: true,
      priority: 1,
    },
    {
      id: 'message',
      label: $localize`:@@lwConsoleDashboards-colMessage:Message`,
      value: (line) => line.message,
      mono: true,
      priority: 1,
    },
  ];
  readonly flowId = (row: FlowRow): string =>
    `${row.policy}|${row.src}|${row.dst}|${row.protocol}|${row.port}|${row.decision}`;
  readonly loadingLabel = $localize`:@@lwConsoleDashboards-widgetLoading:Loading widget`;
  readonly formatValue = formatMetricValue;

  /** The log line's time (the cell template's row is untyped). */
  lineTime(line: LogLine): string {
    return line.at;
  }
}
