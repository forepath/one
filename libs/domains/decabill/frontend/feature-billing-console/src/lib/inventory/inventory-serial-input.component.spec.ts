import { TestBed } from '@angular/core/testing';

import { InventorySerialInputComponent, type InventorySerialSelection } from './inventory-serial-input.component';

describe('InventorySerialInputComponent', () => {
  function create(available: string[] | null) {
    TestBed.configureTestingModule({ imports: [InventorySerialInputComponent] });

    const fixture = TestBed.createComponent(InventorySerialInputComponent);
    const emitted: InventorySerialSelection[] = [];

    fixture.componentRef.setInput('available', available);
    fixture.componentInstance.selectionChange.subscribe((selection) => emitted.push(selection));
    fixture.detectChanges();

    return { fixture, input: fixture.componentInstance, emitted };
  }

  it('expands singles and ranges and emits compact tokens', () => {
    const { fixture, input, emitted } = create(null);

    input.value.set('SN-01..SN-03\nX9, SN-04');
    fixture.detectChanges();

    expect(input.count()).toBe(5);
    expect(emitted.at(-1)).toEqual({
      serialNumbers: ['SN-01', 'SN-02', 'SN-03', 'X9', 'SN-04'],
      tokens: ['SN-01..SN-04', 'X9'],
      valid: true,
    });
    expect(fixture.nativeElement.textContent).toContain('5 serial numbers');
  });

  it('reports invalid tokens and serial numbers that are not available', () => {
    const { fixture, input, emitted } = create(['A1', 'A2', 'A5']);

    input.value.set('A1..A3\nbad token');
    fixture.detectChanges();

    expect(emitted.at(-1)?.valid).toBe(false);
    expect(input.errors()).toEqual([{ token: 'bad token', label: expect.any(String) }]);
    expect(input.missing()).toEqual(['A3']);
    expect(fixture.nativeElement.querySelector('[data-testid="serial-missing"]').textContent).toContain('A3');
  });

  it('picks single units, all matching or all available ones from the typeahead (compact ranges)', () => {
    const available = Array.from({ length: 300 }, (_, index) => `LAP-${String(index + 1).padStart(3, '0')}`);
    const { fixture, input } = create([...available, 'MOUSE-1']);
    const event = () => new Event('mousedown');

    expect(input.remaining()).toHaveLength(301);
    expect(input.pickShown()).toHaveLength(20);

    input.onPickQuery('LAP-00');
    expect(input.pickMatches()).toHaveLength(9);

    input.pickMany(['LAP-150'], event());
    fixture.detectChanges();
    expect(input.value()).toBe('LAP-150');
    expect(input.pickOpen()).toBe(false);
    expect(input.remaining()).toHaveLength(300);

    input.onPickQuery('LAP-00');
    input.pickMany(input.pickMatches(), event());
    fixture.detectChanges();
    expect(input.value()).toBe('LAP-150\nLAP-001..LAP-009');

    input.pickMany(input.remaining(), event());
    fixture.detectChanges();
    expect(input.count()).toBe(301);
    expect(input.remaining()).toEqual([]);
    expect(input.selection().valid).toBe(true);
  });
});
