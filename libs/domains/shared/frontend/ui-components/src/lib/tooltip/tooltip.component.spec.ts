import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FpcTooltipComponent } from './tooltip.component';

const BUBBLE_WIDTH = 160;
const BUBBLE_HEIGHT = 220;

@Component({
  standalone: true,
  imports: [FpcTooltipComponent],
  template: `
    <div class="scroller" style="overflow: auto">
      <div class="cell" style="overflow: hidden">
        <fpc-tooltip text="tickets:read&#10;tickets:write&#10;knowledge:read" placement="top" appearance="panel">
          <span class="badge-anchor">3 scopes</span>
        </fpc-tooltip>
      </div>
    </div>
  `,
})
class HostComponent {}

describe('FpcTooltipComponent placement', () => {
  let fixture: ComponentFixture<HostComponent>;
  let rects: Map<string, DOMRect>;
  const rectOf = (el: Element): DOMRect => {
    if (el.classList.contains('fpc-tooltip__bubble')) {
      return new DOMRect(0, 0, BUBBLE_WIDTH, BUBBLE_HEIGHT);
    }

    for (const [selector, rect] of rects) {
      if (el.matches(selector)) {
        return rect;
      }
    }

    return new DOMRect(0, 0, 0, 0);
  };

  beforeEach(async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return rectOf(this);
    });
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('fpc-tooltip__bubble') ? BUBBLE_HEIGHT : 0;
    });

    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    document.querySelectorAll('body > .fpc-tooltip__bubble').forEach((bubble) => bubble.remove());
  });

  const open = async (): Promise<HTMLElement> => {
    (fixture.nativeElement.querySelector('.fpc-tooltip__anchor') as HTMLElement).dispatchEvent(
      new MouseEvent('mouseenter'),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return document.querySelector('.fpc-tooltip__bubble') as HTMLElement;
  };

  it('is not squeezed to the height of a clipping table cell', async () => {
    rects = new Map([
      ['.scroller', new DOMRect(0, 100, 1000, 600)],
      ['.cell', new DOMRect(100, 400, 200, 40)],
      ['fpc-tooltip', new DOMRect(120, 410, 80, 20)],
    ]);

    const bubble = await open();

    expect(bubble.parentElement).toBe(document.body);
    expect(bubble.style.maxHeight).toBe('');
    // Above the anchor (preferred side), at its full height.
    expect(bubble.style.top).toBe(`${410 - 6 - BUBBLE_HEIGHT}px`);
  });

  it('uses the viewport when the scroll area is too short on both sides instead of shrinking', async () => {
    rects = new Map([
      ['.scroller', new DOMRect(0, 380, 1000, 80)],
      ['.cell', new DOMRect(100, 400, 200, 40)],
      ['fpc-tooltip', new DOMRect(120, 410, 80, 20)],
    ]);

    const bubble = await open();

    expect(bubble.style.maxHeight).toBe('');
    expect(bubble.style.top).toBe(`${410 - 6 - BUBBLE_HEIGHT}px`);
  });

  it('still flips below when the scroll area has no room above (sticky strip on top)', async () => {
    rects = new Map([
      ['.scroller', new DOMRect(0, 380, 1000, 420)],
      ['.cell', new DOMRect(100, 400, 200, 40)],
      ['fpc-tooltip', new DOMRect(120, 410, 80, 20)],
    ]);

    const bubble = await open();

    expect(bubble.style.maxHeight).toBe('');
    expect(bubble.style.top).toBe(`${430 + 6}px`);
  });
});
