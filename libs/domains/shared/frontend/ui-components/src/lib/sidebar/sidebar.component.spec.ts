import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FpcSidebarPopoverComponent } from '../sidebar-popover/sidebar-popover.component';

import { fpcReadSidebarCollapsed, fpcWriteSidebarCollapsed, FpcSidebarComponent } from './sidebar.component';

@Component({
  standalone: true,
  imports: [FpcSidebarComponent, FpcSidebarPopoverComponent],
  template: `
    <fpc-sidebar storageKey="test-sidebar" collapseLabel="Einklappen" expandLabel="Ausklappen">
      <a href="#/one" class="sidebar__item" data-testid="link"
        ><i class="bi bi-grid"></i><span class="small">One</span></a
      >
      <fpc-sidebar-popover>
        <span fpcSidebarPopoverTrigger class="sidebar__item" role="button" tabindex="0" data-testid="trigger">
          <i class="bi bi-gear"></i><span class="small">Group</span>
        </span>
        <a href="#/two" class="sidebar__item" data-testid="popover-link"><span class="small">Two</span></a>
      </fpc-sidebar-popover>
    </fpc-sidebar>
    <p data-testid="outside">Content</p>
  `,
})
class SidebarHostComponent {}

function mockMatchMedia(matches: boolean): { fire: (next: boolean) => void } {
  let listener: ((event: MediaQueryListEvent) => void) | null = null;

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      addEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => (listener = cb),
      removeEventListener: () => (listener = null),
    }),
  });

  return { fire: (next) => listener?.({ matches: next } as MediaQueryListEvent) };
}

describe('sidebar collapse storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips the preference and ignores anything but true / false', () => {
    fpcWriteSidebarCollapsed(localStorage, 'k', true);
    expect(fpcReadSidebarCollapsed(localStorage, 'k')).toBe(true);
    fpcWriteSidebarCollapsed(localStorage, 'k', false);
    expect(fpcReadSidebarCollapsed(localStorage, 'k')).toBe(false);
    localStorage.setItem('bad', '<img src=x onerror=alert(1)>');
    expect(fpcReadSidebarCollapsed(localStorage, 'bad')).toBeNull();
    expect(fpcReadSidebarCollapsed(localStorage, 'missing')).toBeNull();
    expect(fpcReadSidebarCollapsed(localStorage, null)).toBeNull();
    expect(fpcReadSidebarCollapsed(null, 'k')).toBeNull();
  });

  it('swallows storage failures', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    } as unknown as Storage;

    expect(fpcReadSidebarCollapsed(broken, 'k')).toBeNull();
    expect(() => fpcWriteSidebarCollapsed(broken, 'k', true)).not.toThrow();
  });
});

describe('FpcSidebarComponent', () => {
  let fixture: ComponentFixture<SidebarHostComponent>;
  let root: HTMLElement;
  const originalMatchMedia = window.matchMedia;

  function create(): void {
    fixture = TestBed.createComponent(SidebarHostComponent);
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    TestBed.tick();
    fixture.detectChanges();
  }

  function sidebar(): HTMLElement {
    return root.querySelector('fpc-sidebar') as HTMLElement;
  }

  function toggle(): HTMLButtonElement {
    return root.querySelector('[data-testid="sidebar-collapse-toggle"]') as HTMLButtonElement;
  }

  function click(el: Element): void {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    TestBed.tick();
    fixture.detectChanges();
  }

  beforeEach(() => {
    localStorage.clear();
    mockMatchMedia(false);
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: originalMatchMedia });
  });

  it('starts collapsed to the icon width by default', () => {
    create();

    expect(sidebar().classList).toContain('fpc-sidebar--collapsed');
    expect(sidebar().style.getPropertyValue('--fpc-sidebar-width')).toBe('calc(2rem + 40.5px)');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().getAttribute('aria-label')).toBe('Ausklappen');
    expect(toggle().querySelector('i')?.classList).toContain('bi-chevron-double-right');
  });

  it('expands with the labels and the expanded width and persists the preference', () => {
    create();
    click(toggle());

    expect(sidebar().classList).not.toContain('fpc-sidebar--collapsed');
    expect(sidebar().style.getPropertyValue('--fpc-sidebar-width')).toBe('15rem');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-label')).toBe('Einklappen');
    expect(toggle().querySelector('i')?.classList).toContain('bi-chevron-double-left');
    expect(localStorage.getItem('test-sidebar')).toBe('false');

    click(toggle());
    expect(sidebar().classList).toContain('fpc-sidebar--collapsed');
    expect(localStorage.getItem('test-sidebar')).toBe('true');
  });

  it('restores a stored expanded preference', () => {
    localStorage.setItem('test-sidebar', 'false');
    create();

    expect(sidebar().classList).not.toContain('fpc-sidebar--collapsed');
    expect(sidebar().style.getPropertyValue('--fpc-sidebar-width')).toBe('15rem');
  });

  it('restores a stored collapsed preference', () => {
    localStorage.setItem('test-sidebar', 'true');
    create();

    expect(sidebar().classList).toContain('fpc-sidebar--collapsed');
  });

  it('ignores a malformed stored preference', () => {
    localStorage.setItem('test-sidebar', 'yes');
    create();

    expect(sidebar().classList).toContain('fpc-sidebar--collapsed');
    expect(localStorage.getItem('test-sidebar')).toBe('true');
  });

  it('does not close on navigation on wide screens', () => {
    localStorage.setItem('test-sidebar', 'false');
    create();
    click(root.querySelector('[data-testid="link"]') as Element);

    expect(sidebar().classList).not.toContain('fpc-sidebar--collapsed');
  });

  describe('narrow viewport', () => {
    let media: { fire: (next: boolean) => void };

    beforeEach(() => {
      media = mockMatchMedia(true);
    });

    it('is icon-only regardless of the stored preference and keeps the collapsed layout width', () => {
      localStorage.setItem('test-sidebar', 'false');
      create();

      expect(sidebar().classList).toContain('fpc-sidebar--collapsed');
      expect(sidebar().style.getPropertyValue('--fpc-sidebar-width')).toBe('calc(2rem + 40.5px)');
    });

    it('expands as an overlay without touching the stored preference', () => {
      create();
      click(toggle());

      expect(sidebar().classList).toContain('fpc-sidebar--overlay');
      expect(sidebar().classList).not.toContain('fpc-sidebar--collapsed');
      expect(sidebar().style.getPropertyValue('--fpc-sidebar-width')).toBe('calc(2rem + 40.5px)');
      expect(localStorage.getItem('test-sidebar')).toBe('true');
    });

    it('closes the overlay on navigation but not on a group trigger', () => {
      create();
      click(toggle());
      click(root.querySelector('[data-testid="trigger"]') as Element);
      expect(sidebar().classList).toContain('fpc-sidebar--overlay');

      click(root.querySelector('[data-testid="popover-link"]') as Element);
      expect(sidebar().classList).not.toContain('fpc-sidebar--overlay');
    });

    it('closes the overlay on outside click and Escape', () => {
      create();
      click(toggle());
      click(root.querySelector('[data-testid="outside"]') as Element);
      expect(sidebar().classList).not.toContain('fpc-sidebar--overlay');

      click(toggle());
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
      expect(sidebar().classList).not.toContain('fpc-sidebar--overlay');
    });

    it('drops the overlay when the viewport widens', () => {
      localStorage.setItem('test-sidebar', 'false');
      create();
      click(toggle());
      media.fire(false);
      fixture.detectChanges();

      expect(sidebar().classList).not.toContain('fpc-sidebar--overlay');
      expect(sidebar().classList).not.toContain('fpc-sidebar--collapsed');
    });
  });
});

describe('FpcSidebarPopoverComponent trigger keys', () => {
  it('opens a span trigger with Enter and Space', () => {
    const fixture = TestBed.createComponent(SidebarHostComponent);

    fixture.detectChanges();
    const trigger = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="trigger"]') as HTMLElement;
    const popover = (fixture.nativeElement as HTMLElement).querySelector('fpc-sidebar-popover') as HTMLElement;

    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(popover.querySelector('.fpc-sidebar-popover')).not.toBeNull();
    // The trigger is marked while its popover is open.
    expect(trigger.parentElement?.classList).toContain('fpc-sidebar-popover__trigger--open');

    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    fixture.detectChanges();
    expect(popover.querySelector('.fpc-sidebar-popover')).toBeNull();
    expect(trigger.parentElement?.classList).not.toContain('fpc-sidebar-popover__trigger--open');
  });
});
