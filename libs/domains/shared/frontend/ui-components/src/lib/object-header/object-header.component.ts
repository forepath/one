import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';

import { FpcBreadcrumbItemComponent } from '../breadcrumb-item/breadcrumb-item.component';
import { FpcBreadcrumbsComponent } from '../breadcrumbs/breadcrumbs.component';
import { FpcButtonComponent } from '../button/button.component';
import { FpcDensityService } from '../density/density.service';
import { FpcDropdownComponent } from '../dropdown/dropdown.component';
import { FpcDropdownItemComponent } from '../dropdown-item/dropdown-item.component';
import { FpcMenuItem } from '../menu/menu.types';
import { FpcPageHeaderDensity } from '../page-header/page-header.component';

/**
 * One crumb of an object header (the last one is the current object and has no link). Linked ancestors render as
 * `fpc-breadcrumb-item`s (collapsible into the trail's "…" menu); link-less ancestors stay plain text.
 */
export interface FpcCrumb {
  label: string;
  link?: string | readonly unknown[] | null;
  queryParams?: Record<string, string | number | boolean | null> | null;
  /** Tooltip; defaults to the label. */
  title?: string;
  /** Optional muted kind icon (Bootstrap Icons name without `bi-`). */
  icon?: string | null;
  /** Show only the icon (the label stays the accessible name / tooltip), e.g. a leading "home" crumb. */
  iconOnly?: boolean;
}

/**
 * Header of an object page (Proxmox-style): breadcrumbs, name, status badges, primary
 * actions and an icon-only "More" menu, then (default slot) the object's tab bar. Density follows
 * `FpcDensityService` unless `density` is set.
 *
 * The padded, tinted head block (crumbs + title row) is one group; the tab slot sits below it
 * full-bleed (no inset), like `fpc-page-header` followed by a sibling `fpc-tab-group`.
 *
 * Slots: `[fpcObjectHeaderBadges]` (status / role badges after the name), `[fpcObjectHeaderActions]`
 * (primary `fpc-button`s, icon-only with `ariaLabel` + `title`), default (tabs below the head).
 */
@Component({
  selector: 'fpc-object-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FpcBreadcrumbsComponent,
    FpcBreadcrumbItemComponent,
    FpcButtonComponent,
    FpcDropdownComponent,
    FpcDropdownItemComponent,
  ],
  host: {
    class: 'fpc-object-header',
    '[class.fpc-object-header--compact]': 'resolvedDensity() === "compact"',
  },
  template: `
    <div class="fpc-object-header__head">
      @if (crumbs().length > 0) {
        <fpc-breadcrumbs size="sm" divider="›" class="fpc-object-header__crumbs" [ariaLabel]="breadcrumbsLabel()">
          @for (crumb of crumbs(); track $index; let last = $last) {
            @if (last) {
              <fpc-breadcrumb-item
                [label]="crumb.label"
                [title]="crumb.title ?? null"
                [icon]="crumb.icon ?? null"
                [iconOnly]="!!crumb.iconOnly"
                [active]="true"
              />
            } @else if (crumb.link) {
              <fpc-breadcrumb-item
                [label]="crumb.label"
                [routerLink]="crumb.link"
                [queryParams]="crumb.queryParams ?? null"
                [title]="crumb.title ?? null"
                [icon]="crumb.icon ?? null"
                [iconOnly]="!!crumb.iconOnly"
              />
            } @else {
              <!-- Link-less ancestor: plain muted text, never a dead button (and never collapsed into "…"). -->
              <span
                class="breadcrumb-item fpc-breadcrumb-item"
                role="listitem"
                [attr.title]="crumb.title ?? crumb.label"
                ><span>
                  @if (crumb.icon) {
                    <i class="bi bi-{{ crumb.icon }} fpc-breadcrumb-item__icon" aria-hidden="true"></i>
                  }
                  <span class="fpc-breadcrumb-item__label">{{ crumb.label }}</span></span
                ></span
              >
            }
          }
        </fpc-breadcrumbs>
      }
      <div class="fpc-object-header__row">
        <div class="fpc-object-header__titles">
          <h1 class="fpc-object-header__title mb-0 text-truncate" [attr.title]="title()">{{ title() }}</h1>
          @if (mark()) {
            <span class="fpc-object-header__mark" [attr.title]="markLabel()" aria-hidden="true">●</span>
            <span class="visually-hidden">{{ markLabel() }}</span>
          }
          <span class="fpc-object-header__badges"><ng-content select="[fpcObjectHeaderBadges]" /></span>
          @if (subtitle()) {
            <span class="fpc-object-header__subtitle text-body-secondary text-truncate">{{ subtitle() }}</span>
          }
        </div>
        <div class="fpc-object-header__actions">
          <ng-content select="[fpcObjectHeaderActions]" />
          @if (moreItems().length > 0) {
            <fpc-dropdown #moreMenu alignment="end" appendTo="body" data-testid="fpc-object-header-more">
              <fpc-button
                fpcDropdownTrigger
                variant="secondary"
                size="sm"
                iconOnly
                ariaHaspopup="menu"
                [ariaExpanded]="moreMenu.open()"
                [ariaControls]="moreMenu.open() ? moreMenu.menuId() : null"
                [ariaLabel]="moreLabel()"
                [title]="moreLabel()"
              >
                <i class="bi bi-three-dots-vertical" aria-hidden="true"></i>
              </fpc-button>
              @for (item of moreItems(); track item.id) {
                @if (item.dividerBefore) {
                  <hr class="dropdown-divider" />
                }
                <fpc-dropdown-item
                  [icon]="item.icon ?? null"
                  [disabled]="!!item.disabled"
                  [danger]="!!item.danger"
                  [title]="item.title ?? null"
                  [attr.data-item-id]="item.id"
                  (selected)="moreSelect.emit(item)"
                  >{{ item.label }}</fpc-dropdown-item
                >
              }
            </fpc-dropdown>
          }
        </div>
      </div>
    </div>
    <div class="fpc-object-header__tabs"><ng-content /></div>
  `,
  styleUrl: './object-header.component.scss',
})
export class FpcObjectHeaderComponent {
  private readonly densityService = inject(FpcDensityService);

  readonly title = input('');
  readonly subtitle = input<string | null>(null);
  readonly crumbs = input<readonly FpcCrumb[]>([]);
  /** A pending (draft) change on this object. */
  readonly mark = input(false);
  readonly markLabel = input('Changed in the draft');
  readonly moreItems = input<readonly FpcMenuItem[]>([]);
  readonly moreLabel = input('More');
  readonly breadcrumbsLabel = input('Breadcrumb');
  /** `null` follows the app density. */
  readonly density = input<FpcPageHeaderDensity | null>(null);

  readonly moreSelect = output<FpcMenuItem>();

  protected readonly resolvedDensity = computed<FpcPageHeaderDensity>(
    () => this.density() ?? (this.densityService.isCompact() ? 'compact' : 'default'),
  );
}
