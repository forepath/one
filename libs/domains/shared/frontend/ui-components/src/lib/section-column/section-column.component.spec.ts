import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { FpcSectionColumnComponent } from './section-column.component';

@Component({
  standalone: true,
  imports: [FpcSectionColumnComponent],
  template: `
    <fpc-section-column class="sized" [style.flex-basis.px]="width()" />
    <fpc-section-column class="grown" [grow]="grow()" />
  `,
})
class HostComponent {
  width = signal(300);
  grow = signal<string | null>('0 0 12rem');
}

describe('FpcSectionColumnComponent', () => {
  it("keeps a consumer's own flex-basis binding while no grow is set (the sidebar width of resizable trees)", () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const sized = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.sized');

    expect(sized?.style.flexBasis).toBe('300px');

    fixture.componentInstance.width.set(420);
    fixture.detectChanges();
    expect(sized?.style.flexBasis).toBe('420px');
  });

  it('applies the grow shorthand and drops it again', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const grown = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.grown');

    expect(grown?.style.flex).toMatch(/^0 0 12rem/);

    fixture.componentInstance.grow.set(null);
    fixture.detectChanges();
    expect(grown?.style.flex).toBe('');
  });
});
