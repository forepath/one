import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FpcDockPanelComponent } from './dock-panel.component';

describe('FpcDockPanelComponent', () => {
  let fixture: ComponentFixture<FpcDockPanelComponent>;
  let host: HTMLElement;

  beforeEach(() => {
    localStorage.clear();
    fixture = TestBed.createComponent(FpcDockPanelComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('title', 'Tasks');
  });

  function toggle(): HTMLButtonElement {
    return host.querySelector('[data-testid="fpc-dock-panel-toggle"]') as HTMLButtonElement;
  }

  it('starts collapsed and expands on toggle', () => {
    fixture.detectChanges();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect((host.querySelector('.fpc-dock-panel__body') as HTMLElement).hidden).toBe(true);

    toggle().click();
    fixture.detectChanges();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect((host.querySelector('.fpc-dock-panel__body') as HTMLElement).style.height).toBe('260px');
  });

  it('resizes from the top edge and persists', () => {
    fixture.componentRef.setInput('storageKey', 'dock');
    fixture.componentRef.setInput('collapsed', false);
    fixture.detectChanges();
    const gutter = host.querySelector('[data-testid="fpc-dock-panel-gutter"]') as HTMLElement;

    gutter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    gutter.dispatchEvent(new MouseEvent('pointerdown', { clientY: 500, button: 0 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 400 }));
    window.dispatchEvent(new MouseEvent('pointerup'));
    fixture.detectChanges();
    TestBed.tick();

    expect(fixture.componentInstance.height()).toBe(384);
    expect(JSON.parse(localStorage.getItem('dock') ?? '{}')).toEqual({ size: 384, collapsed: false });
  });

  it('restores the stored state', () => {
    localStorage.setItem('dock', JSON.stringify({ size: 200, collapsed: false }));
    fixture.componentRef.setInput('storageKey', 'dock');
    fixture.detectChanges();
    TestBed.tick();
    expect(fixture.componentInstance.height()).toBe(200);
    expect(fixture.componentInstance.collapsed()).toBe(false);
  });
});
