import { TestBed } from '@angular/core/testing';

import { InventoryBarcodeComponent } from './inventory-barcode.component';

describe('InventoryBarcodeComponent', () => {
  function render(value: string | null, kind: 'gtin' | 'code128') {
    const fixture = TestBed.createComponent(InventoryBarcodeComponent);

    fixture.componentRef.setInput('value', value);
    fixture.componentRef.setInput('kind', kind);
    fixture.detectChanges();

    return fixture.nativeElement as HTMLElement;
  }

  it('draws an EAN-13 with its digits', () => {
    const element = render('4006381333931', 'gtin');

    expect(element.querySelectorAll('g rect').length).toBe(30);
    expect(element.querySelector('text')?.textContent?.trim()).toBe('4006381333931');
  });

  it('draws the internal article number as Code 128', () => {
    const element = render('ART-000001', 'code128');

    expect(element.querySelector('svg')?.getAttribute('aria-label')).toBe('Code 128 ART-000001');
    expect(element.querySelectorAll('g rect').length).toBeGreaterThan(20);
  });

  it('draws nothing for invalid codes (no innerHTML injection path)', () => {
    expect(render('4006381333932', 'gtin').querySelector('svg')).toBeNull();
    expect(render('<img src=x>', 'gtin').querySelector('svg')).toBeNull();
    expect(render(null, 'code128').querySelector('svg')).toBeNull();
  });
});
