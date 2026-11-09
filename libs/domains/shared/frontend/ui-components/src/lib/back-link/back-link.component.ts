import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ActivatedRoute, RouterLink, type Params } from '@angular/router';

/**
 * "Up one level" (the one back affordance of every app): a quiet arrow without button chrome, always first in its
 * header row (`fpcPageHeaderBack` slot of `fpc-page-header`, or the start of a lane / pane header). Never shows text:
 * `label` ("Back to tickets") is its tooltip and accessible name.
 *
 * - With `link`: a real link (router navigation, opens in a new tab, keeps the history), e.g. a detail page.
 * - Without `link`: an in-page view switch (close the open detail and show the list again) via `activate`.
 *
 * Visibility stays with the page: list / detail pages show it on phones only (`class="d-md-none"`), where the detail
 * replaces the list; separate detail pages show it always. Form flows ("Back to login" in an auth card) are text links
 * of the form, not this.
 */
@Component({
  selector: 'fpc-back-link',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, RouterLink],
  host: { class: 'fpc-back-link' },
  template: `
    <ng-template #glyph><i class="bi bi-arrow-left" aria-hidden="true"></i></ng-template>
    @if (link(); as target) {
      <a
        class="fpc-back-link__control"
        [routerLink]="target"
        [queryParams]="queryParams()"
        [relativeTo]="relativeTo() ?? undefined"
        [attr.title]="label()"
        [attr.aria-label]="label()"
        ><ng-container [ngTemplateOutlet]="glyph"
      /></a>
    } @else {
      <button
        type="button"
        class="fpc-back-link__control"
        [disabled]="disabled()"
        [attr.title]="label()"
        [attr.aria-label]="label()"
        (click)="activate.emit()"
      >
        <ng-container [ngTemplateOutlet]="glyph" />
      </button>
    }
  `,
  styleUrl: './back-link.component.scss',
})
export class FpcBackLinkComponent {
  /** Where "back" leads, as a tooltip and accessible name ("Back to tickets"). Required: the arrow has no text. */
  readonly label = input.required<string>();
  /** Router target; without it the control is an in-page view switch (`activate`). */
  readonly link = input<string | unknown[] | null>(null);
  readonly queryParams = input<Params | null>(null);
  /** For relative `link`s from a component other than the routed one. */
  readonly relativeTo = input<ActivatedRoute | null>(null);
  readonly disabled = input(false);
  readonly activate = output<void>();
}
