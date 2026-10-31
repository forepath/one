import { TestBed } from '@angular/core/testing';

import { FpcSummaryCardComponent } from './summary-card.component';

describe('FpcSummaryCardComponent', () => {
  it('keeps a text value on one line with the full text as its tooltip', () => {
    const fixture = TestBed.createComponent(FpcSummaryCardComponent);
    fixture.componentRef.setInput('label', 'Update policy');
    fixture.componentRef.setInput('value', 'Patches automatically in maintenance windows');
    fixture.detectChanges();
    const value = (fixture.nativeElement as HTMLElement).querySelector('.fpc-summary-card__value-text');

    expect(value?.textContent?.trim()).toBe('Patches automatically in maintenance windows');
    expect(value?.getAttribute('title')).toBe('Patches automatically in maintenance windows');
  });

  it('renders no value text (and no tooltip) without a value', () => {
    const fixture = TestBed.createComponent(FpcSummaryCardComponent);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.fpc-summary-card__value-text')).toBeNull();
  });
});
