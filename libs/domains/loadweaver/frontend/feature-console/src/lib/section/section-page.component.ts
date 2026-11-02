import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { ConsoleBackupsFacade, type BackupDeletion } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcFormControlComponent,
  FpcSplitPaneComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';

import { activeConsoleNavPath, type ConsoleNavItem, type ConsoleSectionId } from '../console-nav';
import { ConsoleNavService } from '../nav/console-nav.service';
import { ConsoleSettingsService } from '../nav/console-settings.service';

/** Width of the section sub-nav column: the same bounds as the resource tree (3.37). */
export const SECTION_NAV_MIN = 240;
export const SECTION_NAV_MAX = 480;
export const SECTION_NAV_DEFAULT = 240;

/** The stored width (console settings `sectionNavWidth`), clamped; the default when missing / invalid. */
export function sectionNavWidth(stored: unknown): number {
  const value = typeof stored === 'number' && Number.isFinite(stored) ? Math.round(stored) : SECTION_NAV_DEFAULT;

  return Math.min(SECTION_NAV_MAX, Math.max(SECTION_NAV_MIN, value));
}

/**
 * A section of the function rail (3.37: Activity, Observe, Operate, Delivery, Access): the section's pages as a
 * vertical sub-nav (with headings) beside the routed page; a select on phones. The pages keep their own header.
 */
@Component({
  selector: 'loadweaver-section-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, FpcFormControlComponent, FpcSplitPaneComponent, FpcTabComponent, FpcTabGroupComponent],
  host: { class: 'lw-section' },
  template: `
    <!-- Phones: the sub-nav is a shared fpc-form-control select above the page (the column is hidden below md). -->
    @if (hasNav()) {
      <div class="lw-section__select border-bottom px-3 py-2">
        <label class="visually-hidden" [for]="selectId">{{ title() }}</label>
        <fpc-form-control
          controlType="select"
          size="sm"
          [controlId]="selectId"
          [value]="activePath() ?? ''"
          (valueChange)="open($event)"
          data-testid="console-section-select"
        >
          @for (item of items(); track item.path) {
            <option [value]="item.path" [selected]="item.path === activePath()">
              {{ item.label }}{{ badge(item) ? ' (' + badge(item) + ')' : '' }}
            </option>
          }
        </fpc-form-control>
      </div>
    }
    <!-- Like Resources (3.37): the sub-nav in a resizable left column (width per user), the page on the right. -->
    <fpc-split-pane
      class="lw-section__split"
      [min]="navMin"
      [max]="navMax"
      [defaultSize]="navDefault"
      [size]="navWidth()"
      (sizeChange)="onWidth($event)"
      [collapsed]="!hasNav()"
      [collapsible]="false"
      [separatorLabel]="resizeLabel"
    >
      <nav fpcSplitPaneStart class="lw-section__nav border-end" [attr.aria-label]="title()">
        @if (hasNav()) {
          <fpc-tab-group
            orientation="vertical"
            [stretch]="true"
            [ariaLabel]="title()"
            [activeId]="activePath()"
            (activeIdChange)="open($event)"
            data-testid="console-section-nav"
          >
            @for (item of items(); track item.path) {
              <fpc-tab
                [id]="item.path"
                [label]="item.label"
                [icon]="icon(item.icon)"
                [section]="item.heading ?? null"
                [badge]="badge(item)"
                [badgeLabel]="badgeLabel(item)"
              />
            }
          </fpc-tab-group>
        }
      </nav>
      <div fpcSplitPaneEnd class="lw-section__main fpc-routed-outlet">
        <router-outlet />
      </div>
    </fpc-split-pane>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      flex: 1 1 0;
      min-height: 0;
      min-width: 0;
    }

    .lw-section__split {
      flex: 1 1 0;
      min-height: 0;
    }

    .lw-section__nav {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      overflow: auto;
    }

    .lw-section__main {
      height: 100%;
    }

    .lw-section__select {
      display: none;
    }

    @media (max-width: 767.98px) {
      .lw-section__select {
        display: block;
        flex: 0 0 auto;
      }

      :host ::ng-deep .lw-section__split > .fpc-split-pane__pane--start,
      :host ::ng-deep .lw-section__split > .fpc-split-pane__gutter {
        display: none !important;
      }
    }
  `,
})
export class LoadweaverSectionPageComponent {
  private readonly navigation = inject(ConsoleNavService);
  private readonly router = inject(Router);
  private readonly sectionId = inject(ActivatedRoute).snapshot.data['section'] as ConsoleSectionId;

  private readonly settings = inject(ConsoleSettingsService);
  private widthTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly selectId = `lw-section-select-${this.sectionId}`;
  readonly navMin = SECTION_NAV_MIN;
  readonly navMax = SECTION_NAV_MAX;
  readonly navDefault = SECTION_NAV_DEFAULT;
  /** The column width, per user (console settings, shared by every section). */
  readonly navWidth = computed(() => sectionNavWidth(this.settings.state()['sectionNavWidth']));
  readonly resizeLabel = $localize`:@@lwConsoleSection-resize:Resize the section navigation`;
  readonly items = computed(() => this.navigation.sectionItems(this.sectionId));
  readonly title = computed(() => this.navigation.section(this.sectionId)?.title ?? '');
  readonly activePath = computed(() => activeConsoleNavPath(this.navigation.url(), this.items()));
  /** A single page needs no sub-nav. */
  readonly hasNav = computed(() => this.items().length > 1);
  private readonly backups = inject(ConsoleBackupsFacade);
  /** Open backup deletion requests (the Deletions item's badge, formerly on the backups section bar). */
  private readonly openDeletions = toSignal(this.backups.openDeletions$, { initialValue: [] as BackupDeletion[] });
  private readonly deletionsLabel = $localize`:@@lwConsoleSection-openDeletions:open deletion requests`;

  constructor() {
    let loaded = false;

    // Only where the item is visible (the roles that see deletion requests).
    effect(() => {
      if (!loaded && this.items().some((item) => item.badge === 'backup-deletions'))
        untracked(() => {
          loaded = true;
          this.backups.loadDeletions(true);
        });
    });
  }

  /** The count badge of an item (null = none). */
  badge(item: ConsoleNavItem): number | null {
    if (item.badge !== 'backup-deletions') return null;

    const count = this.openDeletions().length;

    return count > 0 ? count : null;
  }

  badgeLabel(item: ConsoleNavItem): string | null {
    const count = this.badge(item);

    return count ? `${count} ${this.deletionsLabel}` : null;
  }

  protected icon(icon: string): string {
    return icon.replace(/^bi-/, '');
  }

  /** Dragging emits many sizes: the last one is stored once the pointer rests. */
  onWidth(width: number): void {
    if (this.widthTimer) clearTimeout(this.widthTimer);

    this.widthTimer = setTimeout(() => {
      this.widthTimer = null;

      if (sectionNavWidth(width) !== this.navWidth()) this.settings.patch({ sectionNavWidth: sectionNavWidth(width) });
    }, 400);
  }

  open(path: string | null): void {
    if (path && path !== this.activePath()) void this.router.navigateByUrl(path);
  }
}
