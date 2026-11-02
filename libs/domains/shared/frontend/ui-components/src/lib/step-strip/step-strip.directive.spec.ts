import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { FpcStepStripComponent } from './step-strip.component';
import { FpcStepStripDirective } from './step-strip.directive';

@Component({
  standalone: true,
  imports: [FpcStepStripDirective],
  template: `
    <ol fpcStepStrip>
      @for (s of steps; track s; let i = $index) {
        <li>
          <button [attr.aria-current]="i === active() ? 'step' : null">{{ s }}</button>
        </li>
      }
    </ol>
  `,
})
class HostComponent {
  readonly steps = ['General', 'Source image', 'Hardware', 'Network', 'Placement', 'Review'];
  readonly active = signal(0);
}

/** jsdom has no layout: 6 steps of 100 px in a 250 px wide strip. */
function layout(list: HTMLElement): void {
  Object.defineProperty(list, 'clientWidth', { configurable: true, value: 250 });
  Object.defineProperty(list, 'scrollWidth', { configurable: true, value: 600 });
  list.getBoundingClientRect = () => ({ left: 0, right: 250, width: 250 }) as DOMRect;
  [...list.children].forEach((item, index) => {
    (item as HTMLElement).getBoundingClientRect = () =>
      ({ left: index * 100 - list.scrollLeft, right: index * 100 + 100 - list.scrollLeft, width: 100 }) as DOMRect;
  });
  list.scrollTo = ((options: ScrollToOptions) => {
    list.scrollLeft = options.left ?? 0;
  }) as typeof list.scrollTo;
}

describe('FpcStepStripDirective', () => {
  it('marks the list as a one-row strip and pulls the current step into view (centred)', async () => {
    const fixture = TestBed.createComponent(HostComponent);

    fixture.detectChanges();

    const list = fixture.nativeElement.querySelector('ol') as HTMLElement;
    const strip = fixture.debugElement.children[0].injector.get(FpcStepStripDirective);

    expect(list.classList).toContain('fpc-step-strip');
    layout(list);

    // Step 1 is visible: nothing moves.
    strip.reveal(false);
    expect(list.scrollLeft).toBe(0);

    // Step 5 (400–500 px) is out of view: centred → 400 − (250 − 100) / 2 = 325.
    fixture.componentInstance.active.set(4);
    fixture.detectChanges();
    strip.reveal(false);
    expect(list.scrollLeft).toBe(325);

    // The last step is clamped to the end (600 − 250).
    fixture.componentInstance.active.set(5);
    fixture.detectChanges();
    strip.reveal(false);
    expect(list.scrollLeft).toBe(350);
  });

  it('does nothing while every step fits', () => {
    const fixture = TestBed.createComponent(HostComponent);

    fixture.detectChanges();

    const list = fixture.nativeElement.querySelector('ol') as HTMLElement;
    const strip = fixture.debugElement.children[0].injector.get(FpcStepStripDirective);

    layout(list);
    Object.defineProperty(list, 'scrollWidth', { configurable: true, value: 250 });
    fixture.componentInstance.active.set(5);
    fixture.detectChanges();
    strip.reveal(false);
    expect(list.scrollLeft).toBe(0);
  });
});

describe('FpcStepStripDirective chevron state + FpcStepStripComponent', () => {
  @Component({
    standalone: true,
    imports: [FpcStepStripComponent, FpcStepStripDirective],
    template: `
      <fpc-step-strip>
        <ol fpcStepStrip>
          @for (s of steps; track s) {
            <li>{{ s }}</li>
          }
        </ol>
      </fpc-step-strip>
    `,
  })
  class NavHostComponent {
    readonly steps = ['a', 'b', 'c', 'd', 'e', 'f'];
  }

  function render(scrollWidth: number) {
    const fixture = TestBed.createComponent(NavHostComponent);

    fixture.detectChanges();

    const list = fixture.nativeElement.querySelector('ol') as HTMLElement;
    const strip = fixture.debugElement.query((d) => d.nativeElement === list).injector.get(FpcStepStripDirective);

    layout(list);
    Object.defineProperty(list, 'scrollWidth', { configurable: true, value: scrollWidth });
    strip.measure();
    fixture.detectChanges();

    const button = (id: string) =>
      fixture.nativeElement.querySelector(`[data-testid="fpc-step-strip-${id}"]`) as HTMLButtonElement | null;

    return { fixture, list, strip, button };
  }

  it('shows no chevrons while every step fits', () => {
    const { button } = render(250);

    expect(button('previous')).toBeNull();
    expect(button('next')).toBeNull();
  });

  it('shows both chevrons on overflow, disables the one at its end and pages by ¾ of the width', () => {
    const { fixture, list, strip, button } = render(600);

    expect(button('previous')?.disabled).toBe(true);
    expect(button('next')?.disabled).toBe(false);

    button('next')?.click();
    fixture.detectChanges();
    expect(list.scrollLeft).toBe(187.5);
    expect(button('previous')?.disabled).toBe(false);

    strip.page(1);
    fixture.detectChanges();
    expect(list.scrollLeft).toBe(350);
    expect(button('next')?.disabled).toBe(true);
    expect(button('next')).not.toBeNull();
  });
});
