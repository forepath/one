import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { FpcButtonComponent } from '../button/button.component';
import { provideFpcControlSize } from '../control-size/control-size';
import { FpcModalFooterDirective } from './modal-footer.directive';
import { FpcModalComponent, fpcModalContentAtCap } from './modal.component';

@Component({
  standalone: true,
  imports: [FpcModalComponent, FpcModalFooterDirective, FpcButtonComponent],
  template: `
    <fpc-modal [(open)]="open" title="Create thing">
      <p>Body <fpc-button class="body-action">Add row</fpc-button></p>
      <ng-template fpcModalFooter><fpc-button class="primary">Create</fpc-button></ng-template>
    </fpc-modal>
  `,
})
class ModalHostComponent {
  readonly open = signal(true);
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
  function render() {
    // A dense console: buttons and fields default to `sm`.
    TestBed.configureTestingModule({ providers: [provideFpcControlSize('sm')] });

    const fixture = TestBed.createComponent(ModalHostComponent);

    fixture.detectChanges();
    fixture.detectChanges();

    return document.body;
  }

  afterEach(() => document.querySelectorAll('fpc-modal, .modal').forEach((el) => el.remove()));

  it('renders only the projected action(s), no Cancel', () => {
    const footer = render().querySelector('.modal-footer');

    expect(footer?.querySelectorAll('button')).toHaveLength(1);
    expect(footer?.textContent?.trim()).toBe('Create');
  });

  it('sizes footer actions like every other button of the app tier', () => {
    const root = render();

    expect(root.querySelector('.modal-footer .primary .btn')?.classList).toContain('btn-sm');
    expect(root.querySelector('.modal-body .body-action .btn')?.classList).toContain('btn-sm');
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

describe('FpcModalComponent bodyScroll', () => {
  function body(bodyScroll?: boolean): HTMLElement | null {
    const fixture = TestBed.createComponent(FpcModalComponent);

    if (bodyScroll !== undefined) fixture.componentRef.setInput('bodyScroll', bodyScroll);
    fixture.componentRef.setInput('scrollable', true);
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    fixture.detectChanges();

    return document.querySelector('.modal-body');
  }

  afterEach(() => document.querySelectorAll('fpc-modal, .modal').forEach((el) => el.remove()));

  it('lets the body scroll by default', () => {
    expect(body()?.classList.contains('fpc-modal__body--fixed')).toBe(false);
  });

  it('keeps the body from scrolling for self-scrolling content', () => {
    expect(body(false)?.classList.contains('fpc-modal__body--fixed')).toBe(true);
  });
});
