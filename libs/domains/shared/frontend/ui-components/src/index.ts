// Public API of the ForePath component library (`fpc` = ForePath Component).
// Every component is standalone; import the symbols you need directly into a component's
// `imports` array. Global styles live in `styles/index.scss`.

// Actions
export { FpcButtonComponent } from './lib/button/button.component';
export type { FpcButtonSize, FpcButtonType, FpcButtonVariant } from './lib/button/button.component';
export { FpcButtonGroupComponent } from './lib/button-group/button-group.component';
export type { FpcButtonGroupGap, FpcButtonGroupSize } from './lib/button-group/button-group.component';

// Data display
export { FpcAccordionComponent } from './lib/accordion/accordion.component';
export { FPC_ACCORDION_HOST, FpcAccordionItemComponent } from './lib/accordion-item/accordion-item.component';
export type { FpcAccordionHost } from './lib/accordion-item/accordion-item.component';
export { FpcAvatarComponent } from './lib/avatar/avatar.component';
export type { FpcAvatarSize } from './lib/avatar/avatar.component';
export { FpcBadgeComponent } from './lib/badge/badge.component';
export type { FpcBadgeColor, FpcBadgeSize, FpcBadgeVariant } from './lib/badge/badge.component';
export { FpcIconComponent } from './lib/icon/icon.component';
export type { FpcIconSize } from './lib/icon/icon.component';
export { FpcInfiniteScrollDirective } from './lib/infinite-scroll/infinite-scroll.directive';
export { FpcListComponent } from './lib/list/list.component';
export { FpcListAppendFooterComponent } from './lib/list-append-footer/list-append-footer.component';
export { FpcListItemComponent } from './lib/list-item/list-item.component';
export { FpcListSearchComponent } from './lib/list-search/list-search.component';
export { FpcStatusBadgeComponent } from './lib/status-badge/status-badge.component';
export type { FpcStatusBadgeSize, FpcStatusBadgeTone } from './lib/status-badge/status-badge.component';
export { FpcSummaryBarComponent } from './lib/summary-bar/summary-bar.component';
export { FpcSummaryCardComponent } from './lib/summary-card/summary-card.component';
export { FpcSummaryCardValueDirective } from './lib/summary-card/summary-card-value.directive';
export type { FpcSummaryCardTone } from './lib/summary-card/summary-card.component';

// Forms
export { FpcFormControlComponent } from './lib/form-control/form-control.component';
export type { FpcFormControlSize, FpcFormControlType } from './lib/form-control/form-control.component';
export { FpcFormFieldComponent } from './lib/form-field/form-field.component';
export { FpcFormCheckComponent } from './lib/form-check/form-check.component';
export type { FpcFormCheckType } from './lib/form-check/form-check.component';
export { FpcFormCheckGroupComponent } from './lib/form-check-group/form-check-group.component';
export { FpcFormSwitchComponent } from './lib/form-switch/form-switch.component';
export { FpcInputGroupComponent } from './lib/input-group/input-group.component';
export type { FpcInputGroupSize } from './lib/input-group/input-group.component';
export { FpcLabelComponent } from './lib/label/label.component';
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
export type { FpcProgressVariant } from './lib/progress/progress.component';
export { FpcSpinnerComponent } from './lib/spinner/spinner.component';
export type { FpcSpinnerSize, FpcSpinnerType } from './lib/spinner/spinner.component';
export { FpcToastComponent } from './lib/toast/toast.component';
export type { FpcToastVariant } from './lib/toast/toast.component';
export { FpcToastContainerComponent } from './lib/toast-container/toast-container.component';
export type { FpcToastPlacement } from './lib/toast-container/toast-container.component';

// Layout
export { FpcBoardLaneComponent } from './lib/board-lane/board-lane.component';
export { FpcCollapsibleFilterPanelComponent } from './lib/collapsible-filter-panel/collapsible-filter-panel.component';
export { FpcLaneHeaderComponent } from './lib/lane-header/lane-header.component';
export type { FpcLaneHeaderVisibility } from './lib/lane-header/lane-header.component';
export { FpcPageHeaderComponent } from './lib/page-header/page-header.component';
export type { FpcPageHeaderDensity } from './lib/page-header/page-header.component';
export { FpcSectionColumnComponent } from './lib/section-column/section-column.component';
export type { FpcSectionColumnVariant } from './lib/section-column/section-column.component';
export { FpcSectionContainerComponent } from './lib/section-container/section-container.component';
export { FpcSectionRowComponent } from './lib/section-row/section-row.component';

// Navigation
export { FpcBreadcrumbItemComponent } from './lib/breadcrumb-item/breadcrumb-item.component';
export { FpcBreadcrumbsComponent } from './lib/breadcrumbs/breadcrumbs.component';
export type { FpcBreadcrumbsSize } from './lib/breadcrumbs/breadcrumbs.component';
export { FpcTopBarComponent } from './lib/top-bar/top-bar.component';
export { FpcDropdownComponent } from './lib/dropdown/dropdown.component';
export type { FpcDropdownAlignment, FpcDropdownDirection } from './lib/dropdown/dropdown.component';
export { FpcDropdownItemComponent } from './lib/dropdown-item/dropdown-item.component';
export { FpcLanguageSwitcherComponent } from './lib/language-switcher/language-switcher.component';
export type {
  FpcLanguageSwitcherAppearance,
  FpcLanguageSwitcherSize,
  FpcLocaleOption,
} from './lib/language-switcher/language-switcher.component';
export { FpcPaginationComponent } from './lib/pagination/pagination.component';
export type { FpcPaginationSize } from './lib/pagination/pagination.component';
export { FpcSidebarComponent } from './lib/sidebar/sidebar.component';
export { FpcSidebarNavItemComponent } from './lib/sidebar-nav-item/sidebar-nav-item.component';
export { FpcSidebarPopoverComponent } from './lib/sidebar-popover/sidebar-popover.component';
export { FpcTabComponent } from './lib/tab/tab.component';
export { FpcTabGroupComponent } from './lib/tab-group/tab-group.component';
export { FpcThemeSwitcherComponent } from './lib/theme-switcher/theme-switcher.component';
export type { FpcThemeSwitcherVariant } from './lib/theme-switcher/theme-switcher.component';

// Overlays
export { FpcConfirmDialogComponent } from './lib/confirm-dialog/confirm-dialog.component';
export { FpcModalComponent } from './lib/modal/modal.component';
export type { FpcModalAccent, FpcModalSize } from './lib/modal/modal.component';
export { FpcModalFooterDirective } from './lib/modal/modal-footer.directive';
export type { FpcTooltipAppearance, FpcTooltipPlacement } from './lib/tooltip/tooltip.component';
export { FpcTooltipComponent } from './lib/tooltip/tooltip.component';
