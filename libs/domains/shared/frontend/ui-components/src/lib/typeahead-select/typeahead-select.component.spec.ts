import { TestBed } from '@angular/core/testing';

import { FpcTypeaheadSelectComponent } from './typeahead-select.component';

describe('FpcTypeaheadSelectComponent', () => {
  const input = (inputs: Record<string, unknown> = {}) => {
    const fixture = TestBed.createComponent(FpcTypeaheadSelectComponent);

    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }

    fixture.detectChanges();

    return (fixture.nativeElement as HTMLElement).querySelector('input') as HTMLInputElement;
  };

  // 3.38 R11: placeholders carry no ellipsis.
  it('defaults the placeholder to "Start typing"', () => {
    expect(input().getAttribute('placeholder')).toBe('Start typing');
  });

  it('uses the consumer placeholder', () => {
    expect(input({ placeholder: 'Search people' }).getAttribute('placeholder')).toBe('Search people');
  });
});
