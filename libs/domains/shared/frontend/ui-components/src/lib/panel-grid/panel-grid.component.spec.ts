import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FpcPanelGridComponent } from './panel-grid.component';

describe('FpcPanelGridComponent', () => {
  let fixture: ComponentFixture<FpcPanelGridComponent>;
  let host: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(FpcPanelGridComponent);
    host = fixture.nativeElement as HTMLElement;
  });

  it('is bordered and content-sized by default', () => {
    fixture.detectChanges();

    expect(host.classList).toContain('fpc-panel-grid--bordered');
    expect(host.classList).not.toContain('fpc-panel-grid--fill');
    expect(host.style.getPropertyValue('--fpc-panel-grid-columns')).toBe('2');
  });

  it('fills the remaining height when asked to', () => {
    fixture.componentRef.setInput('fill', true);
    fixture.componentRef.setInput('columns', 3);
    fixture.detectChanges();

    expect(host.classList).toContain('fpc-panel-grid--fill');
    expect(host.style.getPropertyValue('--fpc-panel-grid-columns')).toBe('3');
  });

  it('fixes the row height for dashboard layouts', () => {
    fixture.detectChanges();
    expect(host.style.getPropertyValue('--fpc-panel-grid-row-height')).toBe('');

    fixture.componentRef.setInput('rowHeight', '96px');
    fixture.detectChanges();
    expect(host.style.getPropertyValue('--fpc-panel-grid-row-height')).toBe('96px');
  });
});
