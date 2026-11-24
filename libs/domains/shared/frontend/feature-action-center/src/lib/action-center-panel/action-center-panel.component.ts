import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  ActionCenterFacade,
  type ActionCenterGroup,
  type ActionCenterSeverity,
  type ActionCenterSilence,
} from '@forepath/shared/frontend/data-access-action-center';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcListToolbarComponent,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';

import {
  ActionCenterStackComponent,
  type ActionCenterStackSilence,
} from '../action-center-stack/action-center-stack.component';
import type { ActionCenterLink } from '../presenters/action-center-presenter.types';
import { ActionCenterPresentersService } from '../presenters/action-center-presenters.service';

import {
  filterActionCenterGroups,
  filterActionCenterSilences,
  isActionCenterFilterActive,
  type ActionCenterFilter,
  type ActionCenterSearchTexts,
} from './action-center-filter';

/** Below this width the panel overlays the content instead of docking beside it. */
export const ACTION_CENTER_OVERLAY_QUERY = '(max-width: 1199.98px)';

/** DOM id of the panel (`aria-controls` of the top-bar toggle). */
export const ACTION_CENTER_PANEL_ID = 'fpc-action-center-panel';

/**
 * The action center sidebar on the right: suggested next steps (setup) on top, then the open to-dos per category as
 * card stacks, and a "Silenced" tab to review and lift silences. It spans the full height below the top bar; on
 * narrow screens it overlays the content (never the top bar), its width capped by the content area.
 */
@Component({
  selector: 'shared-action-center-panel',
  standalone: true,
  imports: [
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcListToolbarComponent,
    FpcPageHeaderComponent,
    FpcSearchFieldComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    FormsModule,
    ActionCenterStackComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './action-center-panel.component.html',
  styleUrl: './action-center-panel.component.scss',
  host: {
    class: 'action-center',
    role: 'complementary',
    '[id]': 'panelId',
    '[attr.aria-label]': 'panelTitle',
    'data-testid': 'action-center-panel',
    '(keydown.escape)': 'onEscape()',
  },
})
export class ActionCenterPanelComponent {
  private readonly facade = inject(ActionCenterFacade);
  private readonly presenters = inject(ActionCenterPresentersService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly panelId = ACTION_CENTER_PANEL_ID;
  protected readonly panelTitle = $localize`:@@featureActionCenter-title:To-dos`;
  protected readonly openTabLabel = $localize`:@@featureActionCenter-tabOpen:Open`;
  protected readonly silencedTabLabel = $localize`:@@featureActionCenter-tabSilenced:Silenced`;
  protected readonly tabsLabel = $localize`:@@featureActionCenter-tabsLabel:To-do views`;
  protected readonly emptyTitle = $localize`:@@featureActionCenter-emptyTitle:All done`;
  protected readonly emptyMessage = $localize`:@@featureActionCenter-emptyMessage:Nothing needs your attention right now. New to-dos appear here as soon as they come up.`;
  protected readonly noSilencesTitle = $localize`:@@featureActionCenter-noSilencesTitle:Nothing silenced`;
  protected readonly noSilencesMessage = $localize`:@@featureActionCenter-noSilencesMessage:Silence a to-do with the bell icon to hide it for you or (admins) for everyone.`;
  protected readonly loadingLabel = $localize`:@@featureActionCenter-loading:Loading to-dos`;

  protected readonly searchPlaceholder = $localize`:@@featureActionCenter-searchPlaceholder:Search to-dos`;
  protected readonly filtersTitle = $localize`:@@featureActionCenter-filtersTitle:Filter to-dos`;
  protected readonly areaLabel = $localize`:@@featureActionCenter-filterArea:Area`;
  protected readonly priorityLabel = $localize`:@@featureActionCenter-filterPriority:Priority`;
  protected readonly anyLabel = $localize`:@@featureActionCenter-filterAny:All`;
  protected readonly noMatchTitle = $localize`:@@featureActionCenter-noMatchTitle:No matching to-dos`;
  protected readonly noMatchMessage = $localize`:@@featureActionCenter-noMatchMessage:Change the search or the filters.`;
  protected readonly severityOptions: ReadonlyArray<{ value: ActionCenterSeverity; label: string }> = [
    { value: 'danger', label: $localize`:@@featureActionCenter-severityDanger:Critical` },
    { value: 'warning', label: $localize`:@@featureActionCenter-severityWarning:Attention` },
    { value: 'info', label: $localize`:@@featureActionCenter-severityInfo:Info` },
  ];

  /** `open` | `silenced` (the tab group's model is a plain string). */
  protected readonly activeTab = signal<string | null>('open');

  /** Search and filters apply to both tabs and survive switching between them. */
  protected readonly search = signal('');
  protected readonly category = signal<string | null>(null);
  protected readonly severity = signal<ActionCenterSeverity | null>(null);
  protected readonly filtersOpen = signal(false);

  protected readonly view = toSignal(this.facade.view$, { initialValue: null });
  protected readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  protected readonly saving = toSignal(this.facade.saving$, { initialValue: false });
  protected readonly error = toSignal(this.facade.error$, { initialValue: null });
  protected readonly setupGroups = toSignal(this.facade.setupGroups$, { initialValue: [] });
  protected readonly taskCategories = toSignal(this.facade.taskCategories$, { initialValue: [] });
  protected readonly silences = toSignal(this.facade.silences$, { initialValue: [] });
  protected readonly canSilenceForEveryone = toSignal(this.facade.canSilenceForEveryone$, { initialValue: false });

  protected readonly openCount = computed(() => this.view()?.counts.open ?? 0);

  private readonly filter = computed<ActionCenterFilter>(() => ({
    search: this.search(),
    category: this.category(),
    severity: this.severity(),
  }));
  protected readonly filterActive = computed(() => isActionCenterFilterActive(this.filter()));
  private readonly searchTexts: ActionCenterSearchTexts = {
    group: (group) => [
      this.presenters.title(group),
      this.presenters.description(group),
      this.presenters.categoryLabel(group.category),
    ],
    item: (group, item) => [this.presenters.itemTitle(group, item), this.presenters.itemMeta(group, item)],
  };
  protected readonly visibleSetupGroups = computed(() =>
    filterActionCenterGroups(this.setupGroups(), this.filter(), this.searchTexts),
  );
  protected readonly visibleTaskCategories = computed(() =>
    this.taskCategories()
      .map((category) => ({
        category: category.category,
        groups: filterActionCenterGroups(category.groups, this.filter(), this.searchTexts),
      }))
      .filter((category) => category.groups.length > 0),
  );
  protected readonly visibleSilences = computed(() =>
    filterActionCenterSilences(this.silences(), this.view()?.groups ?? [], this.filter(), (silence) => [
      this.silenceTitle(silence),
      this.silenceAudience(silence),
      this.silenceScope(silence),
    ]),
  );
  /** Areas of the current view (tasks and setup) for the area filter. */
  protected readonly categoryOptions = computed(() =>
    [...new Set((this.view()?.groups ?? []).map((group: ActionCenterGroup) => group.category))]
      .map((value) => ({ value, label: this.categoryLabel(value) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  );
  protected readonly activeFilterCount = computed(() => (this.category() ? 1 : 0) + (this.severity() ? 1 : 0));

  protected setCategory(value: string | null): void {
    this.category.set(value || null);
  }

  protected setSeverity(value: string | null): void {
    this.severity.set((value || null) as ActionCenterSeverity | null);
  }

  protected clearFilters(): void {
    this.category.set(null);
    this.severity.set(null);
  }
  protected readonly silencedTabBadge = computed(() => this.silences().length || null);

  protected categoryLabel(category: string): string {
    return this.presenters.categoryLabel(category);
  }

  protected categoryCount(groups: ReadonlyArray<{ openCount: number }>): number {
    return groups.reduce((sum, group) => sum + group.openCount, 0);
  }

  protected silenceTitle(silence: ActionCenterSilence): string {
    const typeTitle = this.presenters.presenter(silence.itemType).title;

    if (!silence.itemId) {
      return typeTitle;
    }

    const group = this.view()?.groups.find((entry) => entry.type === silence.itemType);
    const item = group?.items.find((entry) => entry.id === silence.itemId);

    return group && item ? `${typeTitle}: ${this.presenters.itemTitle(group, item)}` : typeTitle;
  }

  protected silenceScope(silence: ActionCenterSilence): string {
    return silence.itemId
      ? $localize`:@@featureActionCenter-silenceScopeItem:One entry`
      : $localize`:@@featureActionCenter-silenceScopeType:All entries`;
  }

  protected silenceAudience(silence: ActionCenterSilence): string {
    return silence.audience === 'everyone'
      ? $localize`:@@featureActionCenter-silenceAudienceEveryone:For everyone`
      : $localize`:@@featureActionCenter-silenceAudienceSelf:For me`;
  }

  protected silenceUntil(silence: ActionCenterSilence): string {
    return silence.until
      ? $localize`:@@featureActionCenter-silenceUntil:Until ${this.presenters.format.date(silence.until)}:date:`
      : $localize`:@@featureActionCenter-silenceIndefinite:Until lifted`;
  }

  protected liftLabel(silence: ActionCenterSilence): string {
    return $localize`:@@featureActionCenter-liftSilence:Lift silence "${this.silenceTitle(silence)}:title:"`;
  }

  protected close(): void {
    this.facade.setPanelOpen(false);
  }

  /** Escape closes the panel, unless it closes an open menu inside it (e.g. the silence menu) first. */
  protected onEscape(): void {
    if (this.host.nativeElement.querySelector('[aria-haspopup][aria-expanded="true"]')) {
      return;
    }

    this.close();
  }

  protected navigate(link: ActionCenterLink): void {
    void this.router.navigate([...link.commands], { queryParams: link.queryParams ?? {} });

    // Overlaying the content: get out of the way after choosing a to-do.
    if (this.document.defaultView?.matchMedia?.(ACTION_CENTER_OVERLAY_QUERY).matches) {
      this.close();
    }
  }

  protected silence(request: ActionCenterStackSilence): void {
    this.facade.silence({
      itemType: request.itemType,
      itemId: request.itemId,
      audience: request.audience,
      until: request.durationMs ? new Date(Date.now() + request.durationMs).toISOString() : null,
    });
  }

  protected lift(silence: ActionCenterSilence): void {
    this.facade.removeSilence(silence.id);
  }

  protected dismissError(): void {
    this.facade.clearError();
  }
}
