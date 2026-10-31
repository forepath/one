import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { FpcPanelComponent } from '../panel/panel.component';
import { FpcBoardLaneComponent } from './board-lane.component';

@Component({
  standalone: true,
  imports: [FpcBoardLaneComponent, FpcPanelComponent],
  template: `
    <fpc-board-lane [scrollX]="wide()"><table class="t"></table></fpc-board-lane>
    <fpc-panel title="Panel" [scroll]="wide()" flush><table class="t"></table></fpc-panel>
  `,
})
class HostComponent {
  wide = signal(false);
}

describe('scroll-both bodies (board lane / panel)', () => {
  it('makes the lane / panel body the scroll container in both axes on request', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const laneBody = el.querySelector('.fpc-board-lane__body') as HTMLElement;
    const panel = el.querySelector('fpc-panel') as HTMLElement;

    expect(laneBody.classList).toContain('fpc-board-lane__body--scroll');
    expect(laneBody.classList).not.toContain('fpc-board-lane__body--scroll-x');
    expect(panel.classList).not.toContain('fpc-panel--scroll');

    fixture.componentInstance.wide.set(true);
    fixture.detectChanges();
    expect(laneBody.classList).toContain('fpc-board-lane__body--scroll-x');
    expect(panel.classList).toContain('fpc-panel--scroll');
    // The table sits directly in the scroll body (no `.table-responsive` wrapper needed).
    expect(laneBody.querySelector(':scope > table.t')).not.toBeNull();
  });
});

@Component({
  standalone: true,
  imports: [FpcBoardLaneComponent],
  template: `
    <fpc-board-lane [padded]="padded()">
      <nav fpcBoardLaneToolbar class="crumbs">a / b</nav>
      <form class="f"></form>
      <span fpcBoardLaneFooter class="pager">1</span>
    </fpc-board-lane>
  `,
})
class SlotsHostComponent {
  padded = signal(false);
}

describe('board lane slots', () => {
  it('pins the toolbar above and the footer below the body and pads the body on request', () => {
    const fixture = TestBed.createComponent(SlotsHostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const body = el.querySelector('.fpc-board-lane__body') as HTMLElement;

    expect(el.querySelector('.fpc-board-lane__toolbar > .crumbs')).not.toBeNull();
    expect(el.querySelector('.fpc-board-lane__footer > .pager')).not.toBeNull();
    expect(body.querySelector(':scope > form.f')).not.toBeNull();
    expect(body.querySelector('.crumbs')).toBeNull();
    expect(body.classList).not.toContain('fpc-board-lane__body--padded');

    fixture.componentInstance.padded.set(true);
    fixture.detectChanges();
    expect(body.classList).toContain('fpc-board-lane__body--padded');
  });
});
