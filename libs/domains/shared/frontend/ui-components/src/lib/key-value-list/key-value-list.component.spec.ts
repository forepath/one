import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { FpcKeyValueDirective, FpcKeyValueItem, FpcKeyValueListComponent } from './key-value-list.component';

@Component({
  standalone: true,
  imports: [FpcKeyValueListComponent, FpcKeyValueDirective],
  template: `
    <fpc-key-value-list [items]="items" [columns]="2">
      <ng-template fpcKeyValue="status" let-item
        ><b class="rich">{{ item.value }}!</b></ng-template
      >
    </fpc-key-value-list>
  `,
})
class HostComponent {
  items: FpcKeyValueItem[] = [
    { key: 'id', label: 'ID', value: 'abc', mono: true },
    { key: 'status', label: 'Status', value: 'ready' },
    { key: 'site', label: 'Site', value: null, hint: 'unplaced' },
  ];
}

describe('FpcKeyValueListComponent', () => {
  it('renders values, templates and the empty text', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.fpc-key-value-list--two')).not.toBeNull();
    expect(host.querySelector('[data-key="id"] dd')?.classList).toContain('font-monospace');
    expect(host.querySelector('[data-key="status"] .rich')?.textContent).toBe('ready!');
    expect(host.querySelector('[data-key="site"] dd')?.textContent).toContain('—');
    expect(host.querySelector('[data-key="site"] dd')?.textContent).toContain('unplaced');
  });
});
