import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FpcMenuItem } from '../menu/menu.types';
import { FpcContextMenuComponent, fpcClampMenuPosition } from './context-menu.component';

describe('FpcContextMenuComponent', () => {
  let fixture: ComponentFixture<FpcContextMenuComponent>;
  let host: HTMLElement;
  const items: FpcMenuItem[] = [
    { id: 'open', label: 'Open', icon: 'box-arrow-up-right' },
    { id: 'drain', label: 'Drain', disabled: true },
    { id: 'delete', label: 'Delete', danger: true, dividerBefore: true },
  ];

  beforeEach(() => {
    fixture = TestBed.createComponent(FpcContextMenuComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('items', items);
  });

  function open(): void {
    fixture.componentRef.setInput('position', { x: 10, y: 20 });
    fixture.detectChanges();
  }

  it('is closed without a position', () => {
    fixture.detectChanges();
    expect(host.querySelector('[data-testid="fpc-context-menu"]')).toBeNull();
  });

  it('renders the entries, emits a selection and closes', () => {
    open();
    const chosen: string[] = [];
    let closed = 0;
    fixture.componentInstance.itemSelect.subscribe((item) => chosen.push(item.id));
    fixture.componentInstance.closed.subscribe(() => closed++);

    const buttons = host.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]');
    expect(buttons).toHaveLength(3);
    expect(buttons[1].disabled).toBe(true);
    expect(host.querySelector('.dropdown-divider')).not.toBeNull();

    buttons[2].click();
    fixture.detectChanges();
    expect(chosen).toEqual(['delete']);
    expect(closed).toBe(1);
    expect(fixture.componentInstance.position()).toBeNull();
  });

  it('closes on Escape and on an outside click', () => {
    open();
    const menu = host.querySelector('[data-testid="fpc-context-menu"]') as HTMLElement;
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(fixture.componentInstance.position()).toBeNull();

    open();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(fixture.componentInstance.position()).toBeNull();
  });

  it('moves the focus over enabled entries with the arrow keys', () => {
    open();
    const menu = host.querySelector('[data-testid="fpc-context-menu"]') as HTMLElement;
    const buttons = host.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]');
    buttons[0].focus();
    buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(buttons[2]);
    buttons[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);
    expect(menu).toBeTruthy();
  });

  it('clamps the menu into the viewport', () => {
    expect(fpcClampMenuPosition({ x: 10, y: 10 }, 100, 100, 800, 600)).toEqual({ x: 10, y: 10 });
    expect(fpcClampMenuPosition({ x: 750, y: 580 }, 100, 100, 800, 600)).toEqual({ x: 692, y: 492 });
  });
});
