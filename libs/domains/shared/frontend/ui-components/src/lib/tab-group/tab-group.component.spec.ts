import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';

import { FpcTabComponent } from '../tab/tab.component';
import { FpcTabGroupComponent, fpcSplitTabOverflow } from './tab-group.component';

@Component({
  standalone: true,
  imports: [FpcTabGroupComponent, FpcTabComponent],
  template: `
    <fpc-tab-group activeId="a">
      <fpc-tab id="a" label="Summary" />
      <fpc-tab id="b" label="Task history" />
    </fpc-tab-group>
  `,
})
class HostComponent {}

function setWidths(label: HTMLElement, scrollWidth: number, clientWidth: number): void {
  Object.defineProperty(label, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(label, 'clientWidth', { configurable: true, value: clientWidth });
}

describe('FpcTabGroupComponent', () => {
  it('shows the full label as a tooltip only while the equal-width tab cuts it off', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button[role="tab"]');
    const [summary, history] = Array.from(buttons);

    setWidths(summary.querySelector('.fpc-tab-group__label') as HTMLElement, 60, 60);
    setWidths(history.querySelector('.fpc-tab-group__label') as HTMLElement, 92, 54);

    summary.dispatchEvent(new Event('mouseenter'));
    history.dispatchEvent(new Event('focus'));
    expect(summary.hasAttribute('title')).toBe(false);
    expect(history.title).toBe('Task history');

    // Wide enough again (resize): the tooltip goes away on the next hover.
    setWidths(history.querySelector('.fpc-tab-group__label') as HTMLElement, 92, 120);
    history.dispatchEvent(new Event('mouseenter'));
    expect(history.hasAttribute('title')).toBe(false);
  });
});

describe('fpcSplitTabOverflow', () => {
  const items = [
    { id: 'a', width: 100 },
    { id: 'b', width: 100 },
    { id: 'c', width: 100 },
    { id: 'd', width: 100 },
    { id: 'e', width: 100 },
  ];

  it('keeps every tab when they all fit (no More)', () => {
    expect(fpcSplitTabOverflow(items, 500, 80, 'a')).toEqual({ visible: ['a', 'b', 'c', 'd', 'e'], hidden: [] });
  });

  it('moves the trailing tabs that do not fit next to More into the menu', () => {
    expect(fpcSplitTabOverflow(items, 400, 80, 'a')).toEqual({ visible: ['a', 'b', 'c'], hidden: ['d', 'e'] });
  });

  it('keeps an overflowed active tab in the bar (last slot), in tab order', () => {
    expect(fpcSplitTabOverflow(items, 400, 80, 'e')).toEqual({ visible: ['a', 'b', 'e'], hidden: ['c', 'd'] });
  });

  it('always shows at least the active (or first) tab', () => {
    expect(fpcSplitTabOverflow(items, 90, 80, 'd')).toEqual({ visible: ['d'], hidden: ['a', 'b', 'c', 'e'] });
    expect(fpcSplitTabOverflow(items, 90, 80, null).visible).toEqual(['a']);
  });
});

@Component({
  standalone: true,
  imports: [FpcTabGroupComponent, FpcTabComponent],
  template: `
    <fpc-tab-group [(activeId)]="active" moreLabel="More tabs">
      @for (id of ids; track id) {
        <fpc-tab [id]="id" [label]="'Tab ' + id" [badge]="id === 'f' ? 3 : null" />
      }
    </fpc-tab-group>
  `,
})
class OverflowHostComponent {
  readonly ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  readonly active = signal<string | null>('a');
}

describe('FpcTabGroupComponent horizontal overflow', () => {
  let barWidth = 0;
  let rectSpy: jest.SpyInstance;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    // jsdom has no layout: every tab item is 100 px, the More item 80 px, the bar `barWidth`.
    rectSpy = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const width = this.hasAttribute('data-fpc-tab-id')
        ? 100
        : this.classList.contains('fpc-tab-group__item--more')
          ? 80
          : 0;

      return {
        width,
        height: 36,
        top: 0,
        left: 0,
        right: width,
        bottom: 36,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });
  });

  afterEach(() => rectSpy.mockRestore());

  function render(width: number, active = 'a') {
    barWidth = width;
    const fixture = TestBed.createComponent(OverflowHostComponent);

    fixture.componentInstance.active.set(active);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const bar = root.querySelector('.fpc-tab-group__bar') as HTMLElement;

    Object.defineProperty(bar, 'clientWidth', { configurable: true, get: () => barWidth });
    const group = fixture.debugElement.query(By.directive(FpcTabGroupComponent))
      .componentInstance as FpcTabGroupComponent;

    group.measureOverflow();
    fixture.detectChanges();

    const shown = () =>
      Array.from(root.querySelectorAll<HTMLElement>('[data-fpc-tab-id]'))
        .filter((item) => !item.classList.contains('fpc-tab-group__item--overflow'))
        .map((item) => item.getAttribute('data-fpc-tab-id'));
    const moreVisible = () => bar.classList.contains('fpc-tab-group__bar--overflowing');

    return { fixture, root, bar, group, shown, moreVisible };
  }

  it('shows no More item when every tab fits', () => {
    const { shown, moreVisible } = render(600);

    expect(shown()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(moreVisible()).toBe(false);
  });

  it('splits by measured width and lists the rest under a labelled menu trigger', () => {
    const { shown, moreVisible, root } = render(400);

    expect(shown()).toEqual(['a', 'b', 'c']);
    expect(moreVisible()).toBe(true);
    const trigger = root.querySelector('.fpc-tab-group__more') as HTMLButtonElement;

    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.textContent).toContain('More tabs');
    expect(trigger.querySelector('.badge')?.textContent?.trim()).toBe('3');
  });

  it('keeps the active tab in the bar even when it would overflow', () => {
    const { shown } = render(400, 'f');

    expect(shown()).toEqual(['a', 'b', 'f']);
  });

  it('activates a tab picked from More and brings it into the bar', async () => {
    const { fixture, root, shown, group } = render(400);

    (root.querySelector('.fpc-tab-group__more') as HTMLButtonElement).click();
    fixture.detectChanges();
    const items = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'));

    expect(items.map((item) => item.textContent?.trim().replace(/\s+/g, ' '))).toEqual(['Tab d', 'Tab e', 'Tab f 3']);
    items[2].click();
    fixture.detectChanges();
    group.measureOverflow();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.active()).toBe('f');
    expect(shown()).toEqual(['a', 'b', 'f']);
  });

  it('re-measures on resize: everything fits again → no More', () => {
    const { fixture, group, shown, moreVisible } = render(400);

    barWidth = 800;
    group.measureOverflow();
    fixture.detectChanges();

    expect(shown()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(moreVisible()).toBe(false);
  });
});
