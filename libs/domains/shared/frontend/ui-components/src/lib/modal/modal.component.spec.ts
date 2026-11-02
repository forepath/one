import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { FpcModalFooterDirective } from './modal-footer.directive';
import { FpcModalComponent, fpcModalContentAtCap } from './modal.component';

@Component({
  standalone: true,
  imports: [FpcModalComponent, FpcModalFooterDirective],
  template: `
    <fpc-modal [(open)]="open" title="Create thing" [cancelLabel]="cancel()">
      <p>Body</p>
      <ng-template fpcModalFooter><button type="button" class="primary">Create</button></ng-template>
    </fpc-modal>
  `,
})
class ModalHostComponent {
  readonly open = signal(true);
  readonly cancel = signal<string | null>('Cancel');
}

describe('FpcModalComponent guardClose', () => {
  function setup(guard: boolean) {
    const fixture = TestBed.createComponent(FpcModalComponent);

    fixture.componentRef.setInput('guardClose', guard);
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    fixture.detectChanges();

    const requests: number[] = [];

    fixture.componentInstance.closeRequest.subscribe(() => requests.push(1));

    return { fixture, requests };
  }

  it('closes on Escape / close button without a guard', () => {
    const { fixture, requests } = setup(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(fixture.componentInstance.open()).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it('asks the consumer instead of closing while guarded; open.set(false) still closes', () => {
    const { fixture, requests } = setup(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.btn-close')?.click();
    expect(fixture.componentInstance.open()).toBe(true);
    expect(requests).toHaveLength(2);

    fixture.componentInstance.open.set(false);
    expect(fixture.componentInstance.open()).toBe(false);
  });
});

describe('FpcModalComponent footer contract', () => {
  function render(cancel: string | null) {
    const fixture = TestBed.createComponent(ModalHostComponent);

    fixture.componentInstance.cancel.set(cancel);
    fixture.detectChanges();
    fixture.detectChanges();

    return fixture;
  }

  it('renders the built-in Cancel before the projected primary and closes through it', () => {
    const fixture = render('Cancel');
    const footer = (fixture.nativeElement as HTMLElement).querySelector('.modal-footer');
    const cancel = footer?.querySelector<HTMLButtonElement>('[data-testid="fpc-modal-cancel"] button');

    expect(cancel?.textContent?.trim()).toBe('Cancel');
    expect(footer?.firstElementChild?.getAttribute('data-testid')).toBe('fpc-modal-cancel');
    expect(footer?.querySelector('button.primary')).not.toBeNull();

    cancel?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('renders no Cancel without a label', () => {
    const fixture = render(null);

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="fpc-modal-cancel"]')).toBeNull();
  });
});

describe('fpcModalContentAtCap', () => {
  const box = (height: number): HTMLElement =>
    ({ getBoundingClientRect: () => ({ height }) as DOMRect }) as unknown as HTMLElement;
  const view = (maxHeight: string) => ({ getComputedStyle: () => ({ maxHeight }) as CSSStyleDeclaration });

  it('is capped once the content reaches its max-height', () => {
    expect(fpcModalContentAtCap(box(800), view('800px'))).toBe(true);
    expect(fpcModalContentAtCap(box(799.4), view('800px'))).toBe(true);
  });

  it('is not capped below the max-height or without one', () => {
    expect(fpcModalContentAtCap(box(420), view('800px'))).toBe(false);
    expect(fpcModalContentAtCap(box(420), view('none'))).toBe(false);
  });
});
