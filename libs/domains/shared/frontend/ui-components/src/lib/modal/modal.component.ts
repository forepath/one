import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  Injector,
  input,
  model,
  OnDestroy,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { FpcModalFooterDirective } from './modal-footer.directive';
import { FpcButtonComponent } from '../button/button.component';
import { FPC_OVERLAY_PORTAL, FpcBodyPortal } from '../overlay/body-portal';

export type FpcModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'fullscreen';

/** Corner close-button fill; warning uses a dark X for contrast on the light fill. */
export type FpcModalAccent = 'primary' | 'danger' | 'warning';

/**
 * Whether a modal content box has reached its CSS `max-height` (the viewport cap). Pure, for the component and tests.
 */
export function fpcModalContentAtCap(content: HTMLElement, view: Pick<Window, 'getComputedStyle'>): boolean {
  const max = Number.parseFloat(view.getComputedStyle(content).maxHeight);

  if (!Number.isFinite(max) || max <= 0) {
    return false;
  }

  return content.getBoundingClientRect().height >= max - 1;
}

/** Bootstrap's default modal fade duration (opacity + dialog transform). */
const MODAL_TRANSITION_MS = 150;

/**
 * Bootstrap modal without the Bootstrap JavaScript bundle: backdrop, body scroll lock, escape
 * handling and initial focus are handled here.
 *
 * Slots: default content is the body; footer content uses `*fpcModalFooter` /
 * `<ng-template fpcModalFooter>` ({@link FpcModalFooterDirective}) so multi-root `@if`/`@else`
 * does not break the footer (NG8011). Optional `[fpcModalTitle]` for a rich title.
 *
 * Import `FpcModalFooterDirective` alongside this component when using a footer slot.
 *
 * Open/close uses Bootstrap's fade classes: mount -> paint -> add `show`, and on close remove
 * `show` then unmount after the transition so enter/exit animate instead of popping.
 *
 * Footer contract (3.38 R14, X-03): [Cancel `dark`, Primary], right-aligned. Set `cancelLabel` (e.g.
 * `cancelLabel="Cancel" i18n-cancelLabel="@@…"`) and the modal renders the Cancel button before the projected footer
 * (it runs `requestClose()`, so `guardClose` applies); the footer template then only carries the primary action.
 * Titles: "Create <noun>" / "Edit <noun>", sentence case. Primary verbs: "Create" (create modals), "Save changes" (edit
 * modals); never "Save" / "Update" / "Add" / "Submit".
 *
 * Sizes by content: `sm` confirmations / one field, `md` (default) short forms up to ~6 fields, `lg` forms with
 * sections or side-by-side fields, `xl` editors / tables / previews, `fullscreen` tool windows.
 *
 * Height: a dialog never grows past the viewport (every size; `fullscreen` fills it). The content is capped at the
 * viewport minus the modal margins; once it reaches the cap (`fpc-modal__dialog--capped`, measured), header and footer
 * stay put and only the body scrolls. Below the cap the body keeps `overflow: visible` (in-body menus aren't clipped).
 *
 * The close button is a quiet icon button in the header row (`accent` only tints its hover ink); header/footer chrome
 * and scrollable body flex live in this component's styles (no global `styles/` modal partials).
 */
@Component({
  selector: 'fpc-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, FpcButtonComponent],
  host: {
    class: 'fpc-modal',
    '[class.fpc-modal--accent-primary]': 'accent() === "primary"',
    '[class.fpc-modal--accent-danger]': 'accent() === "danger"',
    '[class.fpc-modal--accent-warning]': 'accent() === "warning"',
  },
  template: `
    @if (rendered()) {
      <div class="modal-backdrop fade fpc-modal__backdrop" [class.show]="shown()" (click)="onBackdropClick()"></div>
      <div
        #dialog
        class="modal fade d-block fpc-modal__modal"
        [class.show]="shown()"
        tabindex="-1"
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="titleId"
      >
        <div [class]="dialogClasses()" [class.fpc-modal__dialog--capped]="capped()">
          <div class="modal-content" #content>
            <div class="modal-header">
              <h2 class="modal-title fs-5" [id]="titleId">
                @if (title()) {
                  <span>{{ title() }}</span>
                }
                <ng-content select="[fpcModalTitle]" />
              </h2>
              @if (closable()) {
                <button
                  type="button"
                  class="btn-close"
                  [attr.aria-label]="closeAriaLabel()"
                  (click)="requestClose()"
                ></button>
              }
            </div>

            <div class="modal-body">
              <ng-content />
            </div>

            @if (footers().length > 0) {
              <div class="modal-footer" #footerSlot>
                @if (cancelLabel(); as cancel) {
                  <fpc-button
                    variant="dark"
                    class="fpc-modal__cancel"
                    [disabled]="cancelDisabled()"
                    (clicked)="requestClose()"
                    data-testid="fpc-modal-cancel"
                    >{{ cancel }}</fpc-button
                  >
                }
                @for (footer of footers(); track footer) {
                  <ng-container [ngTemplateOutlet]="footer.templateRef" />
                }
              </div>
            }
          </div>
        </div>
      </div>
    }
  `,
  styleUrl: './modal.component.scss',
})
export class FpcModalComponent implements OnDestroy {
  private static nextId = 0;

  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** While open the modal host sits at `<body>` level, so no ancestor stacking context covers it. */
  private readonly portal = new FpcBodyPortal(this.document);
  private readonly portalEnabled = inject(FPC_OVERLAY_PORTAL);

  readonly open = model(false);
  readonly title = input('');
  readonly size = input<FpcModalSize>('md');
  readonly scrollable = input(false, { transform: booleanAttribute });
  readonly centered = input(true, { transform: booleanAttribute });
  readonly closable = input(true, { transform: booleanAttribute });
  readonly closeOnBackdrop = input(true, { transform: booleanAttribute });
  readonly closeOnEscape = input(true, { transform: booleanAttribute });
  readonly closeAriaLabel = input('Close dialog');
  /** Hover ink of the quiet close control (`danger` / `warning`); `primary` keeps the neutral ink. */
  readonly accent = input<FpcModalAccent>('primary');
  /**
   * Label of a built-in Cancel (`dark`) button at the start of the footer (only rendered with a footer template).
   * `null` (default): the footer template brings its own buttons.
   */
  readonly cancelLabel = input<string | null>(null);
  /** Disables the built-in Cancel (e.g. while the primary action runs). */
  readonly cancelDisabled = input(false, { transform: booleanAttribute });
  /**
   * Guards user-initiated closing (close button, Escape, backdrop): instead of closing, `closeRequest` fires and the
   * consumer decides (e.g. a "Discard changes?" confirm while a form is dirty). Programmatic `open.set(false)` still
   * closes.
   */
  readonly guardClose = input(false, { transform: booleanAttribute });

  readonly closed = output<void>();
  /** A user-initiated close attempt while `guardClose` is set. */
  readonly closeRequest = output<void>();

  protected readonly titleId = `fpc-modal-title-${FpcModalComponent.nextId++}`;

  /** Keeps the modal in the DOM while enter/exit transitions run. */
  protected readonly rendered = signal(false);
  /** Drives Bootstrap `.show` on backdrop + dialog after the first paint. */
  protected readonly shown = signal(false);

  /**
   * `descendants: true` so footers nested under consumer `@if` / `@else` / forms still register.
   * Templates do not participate in `ng-content select`, which is what makes this NG8011-safe.
   */
  private readonly footerDirs = contentChildren(FpcModalFooterDirective, { descendants: true });
  protected readonly footers = this.footerDirs;

  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private readonly footerSlot = viewChild<ElementRef<HTMLElement>>('footerSlot');
  private readonly content = viewChild<ElementRef<HTMLElement>>('content');

  /** The content has reached its viewport cap: the body becomes the scroller (header / footer stay visible). */
  protected readonly capped = signal(false);

  private transitionTimer: ReturnType<typeof setTimeout> | null = null;
  private openFrame: number | null = null;

  protected readonly dialogClasses = computed(() => {
    const classes = ['modal-dialog'];
    const size = this.size();

    if (size === 'fullscreen') {
      classes.push('modal-fullscreen');
    } else if (size !== 'md') {
      classes.push(`modal-${size}`);
    }

    if (this.scrollable()) {
      classes.push('modal-dialog-scrollable');
    }

    if (this.centered()) {
      classes.push('modal-dialog-centered');
    }

    return classes.join(' ');
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.clearTransitionWork();
      this.portal.dispose();
    });

    effect(() => {
      const isOpen = this.open();

      if (isOpen) {
        this.beginOpen();
      } else {
        this.beginClose();
      }
    });

    // Height cap: watch the content box; at its `max-height` the body takes over scrolling.
    effect((onCleanup) => {
      const el = this.content()?.nativeElement;
      const view = this.document.defaultView;

      if (!el || !view || typeof view.ResizeObserver === 'undefined') {
        this.capped.set(false);
        return;
      }

      const observer = new view.ResizeObserver(() => this.capped.set(fpcModalContentAtCap(el, view)));
      observer.observe(el);
      onCleanup(() => observer.disconnect());
    });

    // After footer templates render, bind submit controls back to their owning form.
    effect(() => {
      const list = this.footers();
      const slot = this.footerSlot()?.nativeElement;

      if (!slot || list.length === 0 || !this.rendered()) {
        return;
      }

      afterNextRender(
        () => {
          for (const footer of list) {
            if (!footer.formId) {
              continue;
            }

            slot.querySelectorAll('button[type="submit"], input[type="submit"]').forEach((control) => {
              if (!control.getAttribute('form')) {
                control.setAttribute('form', footer.formId!);
              }
            });
          }
        },
        { injector: this.injector },
      );
    });
  }

  ngOnDestroy(): void {
    this.clearTransitionWork();
    this.document.body.classList.remove('modal-open');
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.open() && this.closeOnEscape() && this.closable()) {
      this.requestClose();
    }
  }

  /** A user-initiated close: closes, or asks the consumer via `closeRequest` while `guardClose` is set. */
  requestClose(): void {
    if (this.guardClose()) this.closeRequest.emit();
    else this.close();
  }

  close(): void {
    this.open.set(false);
    this.closed.emit();
  }

  protected onBackdropClick(): void {
    if (this.closeOnBackdrop() && this.closable()) {
      this.requestClose();
    }
  }

  private beginOpen(): void {
    this.clearTransitionWork();
    this.rendered.set(true);
    if (this.portalEnabled) this.portal.attach(this.host.nativeElement);
    this.document.body.classList.add('modal-open');

    afterNextRender(
      () => {
        this.openFrame = requestAnimationFrame(() => {
          this.openFrame = requestAnimationFrame(() => {
            this.openFrame = null;
            this.shown.set(true);
            this.dialog()?.nativeElement.focus();
          });
        });
      },
      { injector: this.injector },
    );
  }

  private beginClose(): void {
    this.clearTransitionWork();

    if (!this.rendered()) {
      this.portal.restore();
      this.document.body.classList.remove('modal-open');
      return;
    }

    this.shown.set(false);
    this.transitionTimer = setTimeout(() => {
      this.transitionTimer = null;
      this.rendered.set(false);
      this.portal.restore();
      this.document.body.classList.remove('modal-open');
    }, MODAL_TRANSITION_MS);
  }

  private clearTransitionWork(): void {
    if (this.openFrame !== null) {
      cancelAnimationFrame(this.openFrame);
      this.openFrame = null;
    }

    if (this.transitionTimer !== null) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }
  }
}
