import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { FpcContextMenuComponent, FpcContextMenuPosition } from '../context-menu/context-menu.component';
import { FpcDropdownComponent } from '../dropdown/dropdown.component';
import { FpcModalComponent } from '../modal/modal.component';
import { FpcBodyPortal, provideFpcOverlayPortal } from './body-portal';

describe('FpcBodyPortal', () => {
  it('moves an element to <body> and restores it in place', () => {
    const parent = document.createElement('section');
    const before = document.createElement('i');
    const el = document.createElement('div');
    const after = document.createElement('b');
    parent.append(before, el, after);
    document.body.appendChild(parent);

    const portal = new FpcBodyPortal(document);
    portal.attach(el);
    expect(el.parentNode).toBe(document.body);
    expect(portal.attached).toBe(true);

    portal.restore();
    expect(Array.from(parent.children)).toEqual([before, el, after]);
    expect(parent.childNodes.length).toBe(3); // placeholder gone

    portal.attach(el);
    portal.dispose();
    expect(el.isConnected).toBe(false);
    parent.remove();
  });
});

@Component({
  standalone: true,
  imports: [FpcModalComponent, FpcContextMenuComponent, FpcDropdownComponent],
  template: `
    <div class="frame" style="position: relative; z-index: 1">
      <fpc-modal [(open)]="open" title="Dialog"><p class="modal-text">Body</p></fpc-modal>
      <fpc-context-menu [items]="[{ id: 'a', label: 'A' }]" [(position)]="menuAt" />
      <fpc-dropdown appendTo="body" [(open)]="menuOpen">
        <button fpcDropdownTrigger type="button">More</button>
        <button type="button" class="dropdown-item item-x">X</button>
      </fpc-dropdown>
    </div>
  `,
})
class OverlayHostComponent {
  open = signal(false);
  menuAt = signal<FpcContextMenuPosition | null>(null);
  menuOpen = signal(false);
}

describe('overlays with provideFpcOverlayPortal()', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideFpcOverlayPortal()] }));

  it('renders the open modal, context menu and appendTo="body" dropdown at <body> level', async () => {
    const fixture = TestBed.createComponent(OverlayHostComponent);
    fixture.autoDetectChanges();
    const host = fixture.componentInstance;
    const frame = fixture.nativeElement.querySelector('.frame') as HTMLElement;

    host.open.set(true);
    host.menuAt.set({ x: 10, y: 10 });
    host.menuOpen.set(true);
    await fixture.whenStable();

    const modal = document.body.querySelector(':scope > fpc-modal') as HTMLElement;
    expect(modal?.querySelector('.modal-text')).not.toBeNull();
    expect(frame.querySelector('fpc-modal')).toBeNull();
    expect(document.body.querySelector(':scope > .fpc-context-menu__menu')).not.toBeNull();
    const menu = document.body.querySelector(':scope > .fpc-dropdown__menu') as HTMLElement;
    expect(menu?.querySelector('.item-x')).not.toBeNull();
    expect(menu.style.position).toBe('fixed');

    // Closing puts the modal host back in place; destroying removes portaled leftovers.
    host.menuAt.set(null);
    await fixture.whenStable();
    expect(document.body.querySelector(':scope > .fpc-context-menu__menu')).toBeNull();
    fixture.destroy();
    expect(document.body.querySelector(':scope > fpc-modal')).toBeNull();
    expect(document.body.querySelector(':scope > .fpc-dropdown__menu')).toBeNull();
  });

  it('keeps overlays inline without the provider', async () => {
    TestBed.resetTestingModule();
    const fixture = TestBed.createComponent(OverlayHostComponent);
    fixture.autoDetectChanges();
    fixture.componentInstance.open.set(true);
    fixture.componentInstance.menuOpen.set(true);
    await fixture.whenStable();

    const frame = fixture.nativeElement.querySelector('.frame') as HTMLElement;
    expect(frame.querySelector('fpc-modal .modal-text')).not.toBeNull();
    expect(frame.querySelector('.fpc-dropdown__menu .item-x')).not.toBeNull();
    fixture.destroy();
  });
});
