import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, Injectable, signal, type Type } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { FpcEmptyStateComponent } from '@forepath/shared/frontend/ui-components';
import { filter, map } from 'rxjs';

/**
 * The selected item of a master-detail section (3.37): list pages inject it optionally to mark the open row; the
 * detail is the child route `:id` (the deep link on every screen size).
 */
@Injectable()
export class MasterDetailState {
  readonly selectedId = signal<string | null>(null);
}

/** Route data of a master-detail shell: the list component and the hint shown while nothing is selected. */
export interface MasterDetailData {
  list: Type<unknown>;
  /** Icon / text of the empty detail lane (≥ xl only). */
  emptyIcon?: string;
  emptyTitle?: string;
  /** Optional component for the empty detail lane instead of the hint (e.g. Alerts → active silences). */
  empty?: Type<unknown>;
  /**
   * Optional KPIs above the row (3.38 R2: a summary bar spans the full page width, never squeezed into the 30 rem
   * list lane), e.g. Backups / Alerts.
   */
  summary?: Type<unknown>;
  /**
   * The list fills the row while nothing is selected (a Lanes page whose master lane narrows to the 30 rem list lane
   * beside the open detail, e.g. Updates: Releases | Update plans | Maintenance windows → Update plans | plan).
   */
  fill?: boolean;
}

/**
 * The id of the deepest child route's `:id` parameter. While the router activates a shell entered from another
 * route, its child routes exist but aren't advanced yet (`snapshot` still undefined): null then — the shell reads the
 * id again on `NavigationEnd`.
 */
export function masterDetailId(route: ActivatedRoute): string | null {
  let child = route.firstChild;

  while (child?.firstChild) child = child.firstChild;

  return child?.snapshot?.paramMap.get('id') ?? null;
}

/**
 * Master-detail lanes (3.37; 3.38: the one master-detail implementation, optional full-width `summary` above): at ≥ xl the list lane (resizable, own scroll) beside the detail lane (the child route,
 * or a hint / the `empty` component while nothing is selected); below xl one lane at a time — the list, or the detail
 * once a row is opened (its route stays the deep link, the browser's back returns to the list).
 */
@Component({
  selector: 'loadweaver-master-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgComponentOutlet, RouterOutlet],
  providers: [MasterDetailState],
  host: {
    class: 'lw-md',
    '[class.lw-md--detail]': '!!state.selectedId()',
    '[class.lw-md--fill]': '!!data().fill && !state.selectedId()',
  },
  styles: `
    /* :host(.lw-md) outranks the global .fpc-routed-outlet > router-outlet + * (column) rule: the lanes sit side
       by side; in a column the list's flex: 0 0 30rem became a 480 px tall band with the detail below it. */
    :host(.lw-md) {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 0;
      min-width: 0;
    }

    .lw-md__summary {
      flex: 0 0 auto;
    }

    /* With a summary above the row, the summary owns the page's top edge (its header / bar draw the bottom): the
       list and detail pages below don't add a second line. */
    .lw-md__summary + .lw-md__row ::ng-deep .fpc-page {
      border-top: 0;
    }

    .lw-md__row {
      display: flex;
      flex-direction: row;
      flex: 1 1 0;
      min-height: 0;
      min-width: 0;
    }

    .lw-md__list,
    .lw-md__detail {
      display: flex;
      flex-direction: column;
      min-height: 0;
      min-width: 0;
      flex: 1 1 auto;
    }

    .lw-md__detail {
      display: none;
    }

    :host(.lw-md--detail) .lw-md__list {
      display: none;
    }

    :host(.lw-md--detail) .lw-md__detail {
      display: flex;
    }

    /* The list page's host (created by the outlet) fills its lane. */
    :host ::ng-deep .lw-md__list > :not(ng-container) {
      display: flex;
      flex-direction: column;
      flex: 1 1 0;
      min-height: 0;
      min-width: 0;
      overflow: hidden;
    }

    @media (min-width: 1200px) {
      .lw-md__list,
      :host(.lw-md--detail) .lw-md__list {
        display: flex;
        flex: 0 0 30rem;
        max-width: 42%;
        border-right: 1px solid var(--bs-border-color);
      }

      .lw-md__detail {
        display: flex;
      }

      /* fill: the list (lanes) takes the row until an entry opens. */
      :host(.lw-md--fill) .lw-md__list {
        flex: 1 1 auto;
        max-width: none;
        border-right: 0;
      }

      :host(.lw-md--fill) .lw-md__detail {
        display: none;
      }
    }
  `,
  template: `
    @if (data().summary; as summary) {
      <div class="lw-md__summary" data-testid="master-detail-summary">
        <ng-container *ngComponentOutlet="summary" />
      </div>
    }
    <div class="lw-md__row">
      <section class="lw-md__list" data-testid="master-detail-list">
        <ng-container *ngComponentOutlet="data().list" />
      </section>
      <section class="lw-md__detail" data-testid="master-detail-detail">
        <div class="fpc-routed-outlet"><router-outlet /></div>
      </section>
    </div>
  `,
})
export class LoadweaverMasterDetailComponent {
  private readonly route = inject(ActivatedRoute);
  readonly state = inject(MasterDetailState);

  readonly data = toSignal(this.route.data.pipe(map((d) => d as MasterDetailData)), {
    initialValue: this.route.snapshot.data as MasterDetailData,
  });

  constructor() {
    const router = inject(Router);

    this.state.selectedId.set(masterDetailId(this.route));
    router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.state.selectedId.set(masterDetailId(this.route)));
  }
}

/** The empty detail lane (≥ xl): a hint, or the shell's `empty` component. */
@Component({
  selector: 'loadweaver-master-detail-empty',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgComponentOutlet, FpcEmptyStateComponent],
  host: {
    class: 'd-flex flex-column flex-grow-1 min-h-0',
    '[class.lw-md-empty--beside-header]': '!data().summary',
  },
  styles: `
    /* The empty detail lane sits beside the list page's own page header (>= xl; with a full-width summary above the
       row the list starts with a lane header instead): its lane headers take the page header's height, title size and
       control tier, so both columns share one header band and the search bands below line up. */
    :host(.lw-md-empty--beside-header) ::ng-deep .fpc-board-lane__header > .fpc-lane-header {
      --fpc-control-height-sm: var(--fpc-control-height-header);
      padding-top: var(--lw-md-empty-head-py, 1rem);
      padding-bottom: var(--lw-md-empty-head-py, 1rem);
      font-size: 1.125rem;
    }

    /* Compact density: the page header's compact padding. */
    :host-context(.fpc-density-compact) {
      --lw-md-empty-head-py: 0.625rem;
    }
  `,
  template: `
    @if (data().empty; as empty) {
      <ng-container *ngComponentOutlet="empty" />
    } @else {
      <fpc-empty-state
        class="m-auto"
        [icon]="data().emptyIcon ?? 'layout-sidebar'"
        [title]="data().emptyTitle ?? hint"
        [message]="pickHint"
        data-testid="master-detail-empty"
      />
    }
  `,
})
export class LoadweaverMasterDetailEmptyComponent {
  private readonly route = inject(ActivatedRoute);

  /** The shell's data (this child inherits it via the parent route). */
  readonly data = computed(() => (this.route.parent?.snapshot.data ?? {}) as MasterDetailData);
  // Empty-state pattern (X-14): a short title + a one-line hint.
  readonly hint = $localize`:@@lwConsoleMasterDetail-empty:Nothing selected`;
  readonly pickHint = $localize`:@@lwConsoleMasterDetail-emptyHint:Pick an entry in the list to see its details here.`;
}
