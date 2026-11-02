import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FpcCommandActivateEvent, FpcCommandGroup, FpcCommandPaletteComponent } from './command-palette.component';

const groups: FpcCommandGroup[] = [
  {
    id: 'nodes',
    label: 'Nodes',
    items: [
      { id: 'n1', label: 'n1', hint: 'site eu' },
      { id: 'n2', label: 'n2' },
    ],
  },
  { id: 'empty', label: 'Empty', items: [] },
  { id: 'tabs', label: 'Go to tab', items: [{ id: 'logs', label: 'Logs', badge: 'Tab' }] },
];

describe('FpcCommandPaletteComponent', () => {
  let fixture: ComponentFixture<FpcCommandPaletteComponent>;

  beforeEach(() => {
    fixture = TestBed.createComponent(FpcCommandPaletteComponent);
    fixture.componentRef.setInput('groups', groups);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
  });

  function input(): HTMLInputElement {
    return document.querySelector('[data-testid="fpc-command-palette-input"]') as HTMLInputElement;
  }

  it('renders non-empty groups and updates the query', () => {
    const options = document.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(3);
    expect(document.querySelectorAll('[role="group"]')).toHaveLength(2);

    input().value = 'n';
    input().dispatchEvent(new Event('input'));
    expect(fixture.componentInstance.query()).toBe('n');
  });

  it('moves with the arrow keys (wrapping) and activates with Enter', () => {
    const events: FpcCommandActivateEvent[] = [];
    fixture.componentInstance.itemActivate.subscribe((event) => events.push(event));

    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    fixture.detectChanges();
    expect(input().getAttribute('aria-activedescendant')).toContain('logs');
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));

    expect(events).toHaveLength(1);
    expect(events[0].item.id).toBe('n2');
    expect(events[0].group.id).toBe('nodes');
    expect(events[0].newTab).toBe(true);
  });

  it('activates an entry on click', () => {
    const events: FpcCommandActivateEvent[] = [];
    fixture.componentInstance.itemActivate.subscribe((event) => events.push(event));
    (document.querySelector('[data-item-id="logs"]') as HTMLElement).click();
    expect(events[0].item.id).toBe('logs');
  });
});
