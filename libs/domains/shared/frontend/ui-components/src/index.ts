// Public API of the ForePath component library (`fpc` = ForePath Component).
// Every component is standalone; import the symbols you need directly into a component's
// `imports` array. Global styles live in `styles/index.scss`.

// Actions
export { FpcButtonComponent } from './lib/button/button.component';
export type { FpcButtonSize, FpcButtonType, FpcButtonVariant } from './lib/button/button.component';
export { FpcButtonGroupComponent } from './lib/button-group/button-group.component';
export type { FpcButtonGroupGap, FpcButtonGroupSize } from './lib/button-group/button-group.component';

// Charts (ApexCharts option presets; global chrome lives in `styles/_charts.scss`)
export {
  FPC_CHART_AREA_FILL,
  FPC_CHART_AXIS,
  FPC_CHART_CATEGORY_LABEL_SPACING,
  FPC_CHART_CATEGORICAL_DARK,
  FPC_CHART_CATEGORICAL_LIGHT,
  FPC_CHART_LEGEND_SCROLL,
  FPC_CHART_RESPONSIVE,
  FPC_CHART_COLORS,
  FPC_CHART_GRID,
  FPC_CHART_LABEL_STYLE,
  FPC_CHART_LEGEND,
  FPC_CHART_PLACEHOLDER_COLOR,
  FPC_CHART_SLICE_LABELS,
  FPC_CHART_SLICE_TOOLTIP,
  fpcChart,
  fpcChartColor,
  fpcChartCategorical,
  fpcChartCategoryAxis,
  fpcChartCategoryStep,
  fpcChartColors,
  fpcChartCountAxis,
  fpcChartTimeAxis,
  fpcChartValueAxis,
} from './lib/chart-theme/chart-theme';
export type { FpcChartType } from './lib/chart-theme/chart-theme';

// Brand tokens (resolved `--bs-*` colours for canvas / third-party renderers)
export {
  FPC_BRAND_ATTRIBUTES,
  fpcCompositeColor,
  fpcCssColorAlpha,
  fpcIsDarkTheme,
  fpcObserveBrandChanges,
  fpcReadBrandPalette,
  fpcReadCssColor,
  fpcToHexColor,
  fpcWithAlpha,
} from './lib/brand-tokens/brand-tokens';
export type { FpcBrandPalette } from './lib/brand-tokens/brand-tokens';

// Display formats (money, dates, ranges, relative time, plural units; X-04)
export {
  fpcFormatDate,
  fpcFormatDateRange,
  fpcFormatDateTime,
  fpcFormatDuration,
  fpcFormatMoney,
  fpcFormatNumber,
  fpcFormatRelative,
  fpcFormatTime,
  fpcPlural,
  fpcToDate,
} from './lib/format/format';
export type { FpcDateInput, FpcDateRangeLabels, FpcDurationUnit, FpcMoneyOptions } from './lib/format/format';
export { FpcDatePipe, FpcDateRangePipe, FpcDurationPipe, FpcMoneyPipe } from './lib/format/format.pipes';

// Data display
export { FpcAccordionComponent } from './lib/accordion/accordion.component';
export { FPC_ACCORDION_HOST, FpcAccordionItemComponent } from './lib/accordion-item/accordion-item.component';
export type { FpcAccordionHost, FpcAccordionItemVariant } from './lib/accordion-item/accordion-item.component';
export { FpcAvatarComponent } from './lib/avatar/avatar.component';
export type { FpcAvatarSize } from './lib/avatar/avatar.component';
export { FpcBadgeComponent } from './lib/badge/badge.component';
export type { FpcBadgeColor, FpcBadgeSize, FpcBadgeTone, FpcBadgeVariant } from './lib/badge/badge.component';
export {
  FPC_DATA_TABLE_DEFAULT_LABELS,
  FPC_DATA_TABLE_LABELS,
  FPC_TABLE_STATE_ICON,
  FPC_TABLE_STATE_SEVERITY,
  fpcColumnValue,
  fpcNextSort,
  fpcPageCount,
  fpcPageSlice,
  fpcStateSortValue,
  fpcSortRows,
  fpcVisibleColumns,
  provideFpcDataTableLabels,
} from './lib/data-table/data-table.model';
export type {
  FpcDataTableLabels,
  FpcTableCellValue,
  FpcTableColumn,
  FpcTableColumnPriority,
  FpcTableSort,
  FpcTableState,
  FpcTableView,
} from './lib/data-table/data-table.model';
export {
  FpcDataTableComponent,
  FpcDataTableFooterDirective,
  FpcTableCellDirective,
  FpcTableRowDetailDirective,
} from './lib/data-table/data-table.component';
export type {
  FpcTableEntry,
  FpcTablePaging,
  FpcTableRowActionEvent,
  FpcTableSelectionMode,
} from './lib/data-table/data-table.component';
export { fpcDropIndex } from './lib/data-table/data-table.drag';
export type { FpcTableDropPredicate, FpcTableRowDropEvent } from './lib/data-table/data-table.drag';
export {
  FPC_BULK_SUMMARY_LABELS,
  fpcBulkSummary,
  fpcCopyIdMenuItem,
  fpcCopyText,
  fpcIsDenied,
  fpcRunBulk,
} from './lib/data-table/data-table.bulk';
export type {
  FpcBulkItemResult,
  FpcBulkOutcome,
  FpcBulkResult,
  FpcBulkSummaryLabels,
} from './lib/data-table/data-table.bulk';
export { FpcKeyValueDirective, FpcKeyValueListComponent } from './lib/key-value-list/key-value-list.component';
export type { FpcKeyValueItem } from './lib/key-value-list/key-value-list.component';
export { FpcTreeComponent } from './lib/tree/tree.component';
export type { FpcTreeContextMenuEvent } from './lib/tree/tree.component';
export {
  fpcFilterTree,
  fpcFlattenTree,
  fpcScrollIntoView,
  fpcTreeBranchIds,
  fpcTreeExpandable,
  fpcTreePath,
  fpcVirtualWindow,
} from './lib/tree/tree.model';
export type { FpcTreeNode, FpcTreeRow, FpcTreeStatus } from './lib/tree/tree.model';
export { FpcGraphCanvasComponent, fpcGraphEdgeId, fpcGraphEdgeWidth } from './lib/graph-canvas/graph-canvas.component';
export type {
  FpcGraphEdge,
  FpcGraphEdgeKind,
  FpcGraphEdgeSelectEvent,
  FpcGraphElement,
  FpcGraphElementKind,
  FpcGraphStatus,
  FpcGraphElementHoverEvent,
  FpcGraphElementSelectEvent,
  FpcGraphHiddenKinds,
  FpcGraphHighlight,
  FpcGraphHighlightMap,
  FpcGraphLayout,
  FpcGraphPositions,
} from './lib/graph-canvas/graph-canvas.types';
export { FpcIconComponent } from './lib/icon/icon.component';
export type { FpcIconSize } from './lib/icon/icon.component';
export { FpcListComponent } from './lib/list/list.component';
export type { FpcListRole } from './lib/list/list.component';
export { FpcListItemComponent } from './lib/list-item/list-item.component';
export type { FpcListItemRole, FpcListItemVariant } from './lib/list-item/list-item.component';
export { FpcListHeaderComponent } from './lib/list-header/list-header.component';
export { FpcListSearchComponent } from './lib/list-search/list-search.component';
export { FpcStatusBadgeComponent } from './lib/status-badge/status-badge.component';
export type { FpcStatusBadgeSize, FpcStatusBadgeTone } from './lib/status-badge/status-badge.component';
export { FpcSummaryBarComponent } from './lib/summary-bar/summary-bar.component';
export { FpcSummaryCardComponent } from './lib/summary-card/summary-card.component';
export { FpcSummaryCardValueDirective } from './lib/summary-card/summary-card-value.directive';
export type { FpcSummaryCardTone } from './lib/summary-card/summary-card.component';
export { FpcTerminalComponent, fpcTerminalGrid, fpcTerminalTheme } from './lib/terminal/terminal.component';
export type { FpcTerminalSize } from './lib/terminal/terminal.component';
export { FpcVncViewerComponent, FPC_VNC_RFB_LOADER } from './lib/vnc-viewer/vnc-viewer.component';
export type { FpcRfbConstructor, FpcRfbInstance, FpcVncState } from './lib/vnc-viewer/vnc-viewer.component';
export { FpcVncChannelAdapter } from './lib/vnc-viewer/vnc-channel';
export type { FpcVncChannel, FpcVncReadyState, FpcVncTransport } from './lib/vnc-viewer/vnc-channel';

// Forms
export {
  FPC_MONACO_THEME_DARK,
  FPC_MONACO_THEME_LIGHT,
  FpcCodeEditorComponent,
  fpcApplyMonacoTheme,
  fpcLineDecorations,
  fpcMonacoTheme,
} from './lib/code-editor/code-editor.component';
export type {
  FpcCodeEditorLanguage,
  FpcCodeLineHighlight,
  FpcCodeLineHighlightKind,
} from './lib/code-editor/code-editor.component';
export { fpcJsonValidator, fpcYamlValidator } from './lib/code-editor/code-editor.validators';
export type {
  FpcCodeDiagnostic,
  FpcCodeDiagnosticSeverity,
  FpcCodeEditorValidator,
  FpcDocumentIssue,
  FpcDocumentValidator,
} from './lib/code-editor/code-editor.validators';
export { FpcFormControlComponent } from './lib/form-control/form-control.component';
export type { FpcFormControlSize, FpcFormControlType } from './lib/form-control/form-control.component';
export { FpcFormFieldComponent } from './lib/form-field/form-field.component';
export { FpcFormCheckComponent } from './lib/form-check/form-check.component';
export type { FpcFormCheckType } from './lib/form-check/form-check.component';
export { FpcFormCheckGroupComponent } from './lib/form-check-group/form-check-group.component';
export { FpcFormSwitchComponent } from './lib/form-switch/form-switch.component';
export {
  FPC_LIST_EDITOR_DEFAULT_LABELS,
  FpcListEditorComponent,
  FpcListEditorItemDirective,
  fpcListMove,
  fpcListRemove,
} from './lib/list-editor/list-editor.component';
export type { FpcListEditorItemContext, FpcListEditorLabels } from './lib/list-editor/list-editor.component';
export {
  FPC_MAP_EDITOR_DEFAULT_LABELS,
  FpcMapEditorComponent,
  fpcMapRowError,
} from './lib/map-editor/map-editor.component';
export type { FpcMapEditorLabels, FpcMapValue } from './lib/map-editor/map-editor.component';
export { FpcFilterChipsComponent, fpcFilterChipText } from './lib/filter-chips/filter-chips.component';
export type { FpcFilterChip } from './lib/filter-chips/filter-chips.component';
export { FpcStepperComponent, fpcStepReachable } from './lib/stepper/stepper.component';
export type { FpcStep } from './lib/stepper/stepper.component';
export { FpcStepStripDirective } from './lib/step-strip/step-strip.directive';
export {
  FPC_STEP_STRIP_LABELS,
  FpcStepStripComponent,
  provideFpcStepStripLabels,
} from './lib/step-strip/step-strip.component';
export type { FpcStepStripLabels } from './lib/step-strip/step-strip.component';
export { FpcInputGroupComponent } from './lib/input-group/input-group.component';
export type { FpcInputGroupSize } from './lib/input-group/input-group.component';
export { FpcLabelComponent } from './lib/label/label.component';
export { FpcMultiSelectComponent } from './lib/multi-select/multi-select.component';
export type { FpcMultiSelectOption } from './lib/multi-select/multi-select.component';
export { FpcOtpInputComponent } from './lib/otp-input/otp-input.component';
export { FpcSearchFieldComponent } from './lib/search-field/search-field.component';
export type { FpcSearchFieldAppearance, FpcSearchFieldSize } from './lib/search-field/search-field.component';
export { FpcTypeaheadSelectComponent } from './lib/typeahead-select/typeahead-select.component';
export type {
  FpcTypeaheadSelectSize,
  FpcTypeaheadSelectVariant,
} from './lib/typeahead-select/typeahead-select.component';

// Feedback
export { FpcAlertComponent } from './lib/alert/alert.component';
export type { FpcAlertVariant } from './lib/alert/alert.component';
export { FpcEmptyStateComponent } from './lib/empty-state/empty-state.component';
export type { FpcEmptyStateSize } from './lib/empty-state/empty-state.component';
export { FpcLoadingOverlayComponent } from './lib/loading-overlay/loading-overlay.component';
export { FpcNotificationIndicatorComponent } from './lib/notification-indicator/notification-indicator.component';
export type {
  FpcNotificationIndicatorKind,
  FpcNotificationIndicatorPlacement,
} from './lib/notification-indicator/notification-indicator.component';
export { FpcProgressComponent } from './lib/progress/progress.component';
export type { FpcProgressSegment, FpcProgressVariant } from './lib/progress/progress.component';
export { FpcProgressRowComponent } from './lib/progress-row/progress-row.component';
export type { FpcProgressRowLayout, FpcProgressRowState } from './lib/progress-row/progress-row.component';
export { FpcProgressRingComponent } from './lib/progress-ring/progress-ring.component';
export type { FpcProgressRingTone } from './lib/progress-ring/progress-ring.component';
export { FpcSpinnerComponent } from './lib/spinner/spinner.component';
export type { FpcSpinnerSize, FpcSpinnerType } from './lib/spinner/spinner.component';
export { FpcToastComponent } from './lib/toast/toast.component';
export type { FpcToastVariant } from './lib/toast/toast.component';
export { FpcToastContainerComponent } from './lib/toast-container/toast-container.component';
export type { FpcToastPlacement } from './lib/toast-container/toast-container.component';

// Layout
export { FpcBoardLaneComponent } from './lib/board-lane/board-lane.component';
export {
  FPC_LIST_TOOLBAR_LABELS,
  FpcListToolbarComponent,
  provideFpcListToolbarLabels,
} from './lib/list-toolbar/list-toolbar.component';
export type { FpcListToolbarLabels } from './lib/list-toolbar/list-toolbar.component';
export { fpcDecodeFilterParam, fpcEncodeFilterParam, fpcListQueryState } from './lib/list-toolbar/list-query-state';
export type {
  FpcFilterValue,
  FpcFilterValues,
  FpcListQueryState,
  FpcListQueryStateOptions,
} from './lib/list-toolbar/list-query-state';
export { FpcLaneHeaderComponent } from './lib/lane-header/lane-header.component';
export type { FpcLaneHeaderVisibility } from './lib/lane-header/lane-header.component';
export { FpcPageHeaderComponent } from './lib/page-header/page-header.component';
export { FpcPanelComponent } from './lib/panel/panel.component';
export { FpcPanelGridComponent } from './lib/panel-grid/panel-grid.component';
export type { FpcPageHeaderDensity } from './lib/page-header/page-header.component';
export { FpcSectionColumnComponent } from './lib/section-column/section-column.component';
export type { FpcSectionColumnVariant } from './lib/section-column/section-column.component';
export { FpcSectionContainerComponent } from './lib/section-container/section-container.component';
export { FpcSectionRowComponent } from './lib/section-row/section-row.component';
export { FpcDockPanelComponent } from './lib/dock-panel/dock-panel.component';
export { FpcObjectHeaderComponent } from './lib/object-header/object-header.component';
export type { FpcCrumb } from './lib/object-header/object-header.component';
export { FpcSplitPaneComponent } from './lib/split-pane/split-pane.component';
export type { FpcSplitPaneOrientation } from './lib/split-pane/split-pane.component';
export { fpcClampSize, fpcReadPaneState, fpcWritePaneState } from './lib/split-pane/pane-state';
export type { FpcPaneState } from './lib/split-pane/pane-state';

// Density (compact by default once the service is injected; `styles/_density.scss`)
export {
  FPC_DENSITY_COMPACT_CLASS,
  FPC_DENSITY_STORAGE_KEY,
  FpcDensityService,
  fpcParseDensity,
  provideFpcDensity,
} from './lib/density/density.service';
export type { FpcDensity } from './lib/density/density.service';

// Navigation
export { FpcBreadcrumbItemComponent } from './lib/breadcrumb-item/breadcrumb-item.component';
export { FpcBreadcrumbsComponent } from './lib/breadcrumbs/breadcrumbs.component';
export type { FpcBreadcrumbsSize } from './lib/breadcrumbs/breadcrumbs.component';
export { FpcTopBarComponent } from './lib/top-bar/top-bar.component';
export { FpcDropdownComponent } from './lib/dropdown/dropdown.component';
export type { FpcDropdownAlignment, FpcDropdownDirection, FpcDropdownWidth } from './lib/dropdown/dropdown.component';
export { FpcDropdownItemComponent } from './lib/dropdown-item/dropdown-item.component';
export { FpcLanguageSwitcherComponent } from './lib/language-switcher/language-switcher.component';
export type {
  FpcLanguageSwitcherAppearance,
  FpcLanguageSwitcherSize,
  FpcLocaleOption,
} from './lib/language-switcher/language-switcher.component';
export { FPC_DEFAULT_PAGE_SIZE, FPC_PAGE_SIZES, FpcPagerComponent, fpcPagerWindow } from './lib/pager/pager.component';
export type { FpcPagerEntry, FpcPagerSize } from './lib/pager/pager.component';
export { FpcSidebarComponent } from './lib/sidebar/sidebar.component';
export { FpcSidebarNavItemComponent } from './lib/sidebar-nav-item/sidebar-nav-item.component';
export { FpcSidebarPopoverComponent } from './lib/sidebar-popover/sidebar-popover.component';
export { FpcTabComponent } from './lib/tab/tab.component';
export {
  FPC_TAB_GROUP_LABELS,
  FpcTabGroupComponent,
  fpcSplitTabOverflow,
  provideFpcTabGroupLabels,
} from './lib/tab-group/tab-group.component';
export type { FpcTabGroupLabels, FpcTabOverflowItem } from './lib/tab-group/tab-group.component';
export { FpcThemeSwitcherComponent } from './lib/theme-switcher/theme-switcher.component';
export type { FpcThemeSwitcherVariant } from './lib/theme-switcher/theme-switcher.component';
export { FpcCommandPaletteComponent } from './lib/command-palette/command-palette.component';
export type {
  FpcCommandActivateEvent,
  FpcCommandGroup,
  FpcCommandItem,
} from './lib/command-palette/command-palette.component';

// Overlays
export { FpcContextMenuComponent, fpcClampMenuPosition } from './lib/context-menu/context-menu.component';
export type { FpcContextMenuPosition } from './lib/context-menu/context-menu.component';
export { FpcLongPressDirective } from './lib/long-press/long-press.directive';
export { fpcEnabledMenuItems } from './lib/menu/menu.types';
export type { FpcMenuItem } from './lib/menu/menu.types';
export { FpcConfirmDialogComponent } from './lib/confirm-dialog/confirm-dialog.component';
export { FpcModalComponent } from './lib/modal/modal.component';
export type { FpcModalAccent, FpcModalSize } from './lib/modal/modal.component';
export { FpcModalFooterDirective } from './lib/modal/modal-footer.directive';
export { FPC_MODAL_TRANSITION_MS, FpcModalSwap } from './lib/modal/modal-swap';
export { FPC_OVERLAY_PORTAL, FpcBodyPortal, provideFpcOverlayPortal } from './lib/overlay/body-portal';
export type { FpcTooltipAppearance, FpcTooltipPlacement } from './lib/tooltip/tooltip.component';
export { FpcTooltipComponent } from './lib/tooltip/tooltip.component';
