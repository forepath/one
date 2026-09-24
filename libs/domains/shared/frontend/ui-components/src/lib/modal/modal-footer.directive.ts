import { Directive, inject, TemplateRef, ViewContainerRef } from '@angular/core';

/**
 * Structural / template slot for modal footer content.
 *
 * Use `*fpcModalFooter` (or `<ng-template fpcModalFooter>`) so the footer is a template, not
 * regular projected DOM. `fpc-modal` picks these up via `contentChildren` and renders them in
 * `.modal-footer`, which keeps working under multi-root `@if` / `@else` (NG8011).
 *
 * When the anchor sits inside a `<form>`, submit controls are linked with the native `form`
 * attribute after the footer view is created.
 */
@Directive({
  selector: '[fpcModalFooter]',
  standalone: true,
})
export class FpcModalFooterDirective {
  readonly templateRef = inject(TemplateRef<unknown>);
  private readonly viewContainer = inject(ViewContainerRef);

  /** Owning form id when the footer anchor is nested inside a `<form>`. */
  readonly formId: string | null;

  private static nextFormId = 0;

  constructor() {
    const anchor = this.viewContainer.element.nativeElement as Comment | HTMLElement;
    const parent = anchor.parentElement;
    const form = parent?.closest?.('form') ?? (parent instanceof HTMLFormElement ? parent : null);

    if (form instanceof HTMLFormElement) {
      if (!form.id) {
        form.id = `fpc-modal-form-${FpcModalFooterDirective.nextFormId++}`;
      }

      this.formId = form.id;
    } else {
      this.formId = null;
    }
  }
}
