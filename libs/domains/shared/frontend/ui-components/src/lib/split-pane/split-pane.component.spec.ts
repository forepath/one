import { ComponentFixture, TestBed } from '@angular/core/testing';

import { fpcClampSize, fpcReadPaneState, fpcSeparatorKeySize, fpcWritePaneState } from './pane-state';
import { FpcSplitPaneComponent } from './split-pane.component';

describe('pane state', () => {
  beforeEach(() => localStorage.clear());

  it('clamps sizes', () => {
    expect(fpcClampSize(100, 240, 480)).toBe(240);
    expect(fpcClampSize(999, 240, 480)).toBe(480);
    expect(fpcClampSize(Number.NaN, 240, 480)).toBe(240);
  });

  it('round-trips the stored state and ignores garbage', () => {
    fpcWritePaneState(localStorage, 'k', { size: 320, collapsed: true });
    expect(fpcReadPaneState(localStorage, 'k')).toEqual({ size: 320, collapsed: true });
    localStorage.setItem('bad', '{');
    expect(fpcReadPaneState(localStorage, 'bad')).toBeNull();
    expect(fpcReadPaneState(localStorage, null)).toBeNull();
  });

  it('maps separator keys to sizes', () => {
    expect(fpcSeparatorKeySize('ArrowRight', 300, 240, 480, 16, ['ArrowRight'], ['ArrowLeft'])).toBe(316);
    expect(fpcSeparatorKeySize('ArrowLeft', 250, 240, 480, 16, ['ArrowRight'], ['ArrowLeft'])).toBe(240);
    expect(fpcSeparatorKeySize('End', 300, 240, 480, 16, [], [])).toBe(480);
    expect(fpcSeparatorKeySize('x', 300, 240, 480, 16, [], [])).toBeNull();
  });
});

describe('FpcSplitPaneComponent', () => {
  let fixture: ComponentFixture<FpcSplitPaneComponent>;
  let host: HTMLElement;

  beforeEach(() => {
    localStorage.clear();
    fixture = TestBed.createComponent(FpcSplitPaneComponent);
    host = fixture.nativeElement as HTMLElement;
  });

  function gutter(): HTMLElement {
    return host.querySelector('[data-testid="fpc-split-pane-gutter"]') as HTMLElement;
  }

  it('sizes the fixed pane and resizes with the keyboard', () => {
    fixture.componentRef.setInput('min', 240);
    fixture.componentRef.setInput('max', 480);
    fixture.detectChanges();

    expect((host.querySelector('.fpc-split-pane__pane--start') as HTMLElement).style.flex).toContain('300px');
    gutter().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.size()).toBe(316);
    expect(gutter().getAttribute('aria-valuenow')).toBe('316');
  });

  it('grows the end pane with the opposite key when the end pane is fixed', () => {
    fixture.componentRef.setInput('fixed', 'end');
    fixture.detectChanges();
    gutter().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(fixture.componentInstance.size()).toBe(316);
  });

  it('resizes by dragging', () => {
    fixture.detectChanges();
    gutter().dispatchEvent(Object.assign(new MouseEvent('pointerdown', { clientX: 100, button: 0 })));
    window.dispatchEvent(Object.assign(new MouseEvent('pointermove', { clientX: 150 })));
    window.dispatchEvent(new MouseEvent('pointerup'));
    expect(fixture.componentInstance.size()).toBe(350);
  });

  it('collapses with Enter and persists the state', () => {
    fixture.componentRef.setInput('storageKey', 'tree');
    fixture.detectChanges();
    gutter().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    TestBed.tick();

    expect(fixture.componentInstance.collapsed()).toBe(true);
    expect((host.querySelector('.fpc-split-pane__pane--start') as HTMLElement).hidden).toBe(true);
    expect(JSON.parse(localStorage.getItem('tree') ?? '{}')).toEqual({ size: 300, collapsed: true });
  });

  it('restores the stored size', () => {
    localStorage.setItem('tree', JSON.stringify({ size: 400, collapsed: false }));
    fixture.componentRef.setInput('storageKey', 'tree');
    fixture.detectChanges();
    TestBed.tick();
    expect(fixture.componentInstance.size()).toBe(400);
  });
});
