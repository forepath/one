import { TestBed } from '@angular/core/testing';

import { EinvoiceSettingsFieldsComponent } from './einvoice-settings-fields.component';

describe('EinvoiceSettingsFieldsComponent', () => {
  const formats = [
    { format: 'factur-x-en16931', label: 'Factur-X / ZUGFeRD EN 16931' },
    { format: 'xrechnung-cii', label: 'XRechnung 3.0 (CII)' },
    { format: 'peppol-bis-3', label: 'Peppol BIS Billing 3.0 (UBL)' },
  ];

  function create(inputs: Record<string, unknown>) {
    const fixture = TestBed.createComponent(EinvoiceSettingsFieldsComponent);

    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);

    fixture.detectChanges();

    return fixture;
  }

  it('offers the issuer default with its label plus every format', () => {
    const fixture = create({ formats, defaultFormat: 'factur-x-en16931' });
    const options = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid="einvoice-format-select"] option'),
    ).map((option) => option.textContent?.trim());

    expect(options).toEqual([
      'Issuer default (Factur-X / ZUGFeRD EN 16931)',
      'Factur-X / ZUGFeRD EN 16931',
      'XRechnung 3.0 (CII)',
      'Peppol BIS Billing 3.0 (UBL)',
    ]);
  });

  it('hides the format select without capabilities (self-service)', () => {
    const fixture = create({ formats: [] });

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="einvoice-format-select"]')).toBeNull();
  });

  it('explains XRechnung / Peppol requirements for the effective format', () => {
    const fixture = create({ formats, defaultFormat: 'xrechnung-cii' });
    const component = fixture.componentInstance;

    expect(component.buyerReferenceHint()).toContain('Leitweg-ID');
    expect(component.endpointHint()).toContain('Peppol');

    fixture.componentRef.setInput('format', 'peppol-bis-3');
    expect(component.formatHint()).toContain('Peppol');
    expect(component.buyerReferenceHint()).toContain('Optional');

    fixture.componentRef.setInput('endpoint', 'not-an-endpoint');
    expect(component.endpointValid()).toBe(false);
    expect(component.endpointHint()).toContain('scheme:id');
  });
});
