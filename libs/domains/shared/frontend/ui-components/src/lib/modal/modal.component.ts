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

export type FpcModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'fullscreen';

/** Corner close-button fill; warning uses a dark X for contrast on the light fill. */
export type FpcModalAccent = 'primary' | 'danger' | 'warning';

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
 * Open/close uses Bootstrap's fade classes: mount → paint → add `show`, and on close remove
 * `show` then unmount after the transition so enter/exit animate instead of popping.
 *
 * Accent close button (`accent` input; fill + X ink match `.btn-{accent}` colors), header/footer
 * chrome, and scrollable body flex live in this component's styles (no global `styles/` modal
 * partials).
 */
@Component({
  selector: 'fpc-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
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
        <div [class]="dialogClasses()">
          <div class="modal-content">
            <div class="modal-header">
              <h2 class="modal-title fs-5" [id]="titleId">
                @if (title()) {
                  <span>{{ title() }}</span>
                }
                <ng-content select="[fpcModalTitle]" />
              </h2>
              @if (closable()) {
                <button type="button" class="btn-close" [attr.aria-label]="closeAriaLabel()" (click)="close()"></button>
              }
            </div>

            <div class="modal-body">
              <ng-content />
            </div>

            @if (footers().length > 0) {
              <div class="modal-footer" #footerSlot>
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

  readonly open = model(false);
  readonly title = input('');
  readonly size = input<FpcModalSize>('md');
  readonly scrollable = input(false, { transform: booleanAttribute });
  readonly centered = input(true, { transform: booleanAttribute });
  readonly closable = input(true, { transform: booleanAttribute });
  readonly closeOnBackdrop = input(true, { transform: booleanAttribute });
  readonly closeOnEscape = input(true, { transform: booleanAttribute });
  readonly closeAriaLabel = input('Close dialog');
  /** Fill color for the corner close control (default primary). */
  readonly accent = input<FpcModalAccent>('primary');

  readonly closed = output<void>();

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
    this.destroyRef.onDestroy(() => this.clearTransitionWork());

    effect(() => {
      const isOpen = this.open();

      if (isOpen) {
        this.beginOpen();
      } else {
        this.beginClose();
      }
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
      this.close();
    }
  }

  close(): void {
    this.open.set(false);
    this.closed.emit();
  }

  protected onBackdropClick(): void {
    if (this.closeOnBackdrop() && this.closable()) {
      this.close();
    }
  }

  private beginOpen(): void {
    this.clearTransitionWork();
    this.rendered.set(true);
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
      this.document.body.classList.remove('modal-open');
      return;
    }

    this.shown.set(false);
    this.transitionTimer = setTimeout(() => {
      this.transitionTimer = null;
      this.rendered.set(false);
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
