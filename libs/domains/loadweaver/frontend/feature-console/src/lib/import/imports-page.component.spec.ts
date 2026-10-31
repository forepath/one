import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ImportService, type ImportSummary } from '@forepath/loadweaver/frontend/data-access-console';
import { of } from 'rxjs';

import { LoadweaverImportsPageComponent } from './imports-page.component';

function entry(node: string, hostname: string): ImportSummary {
  return {
    node,
    lifecycle: 'pending',
    connected: true,
    hostname,
    discoveryId: 'd-' + node,
    discoveredAt: '2026-10-01T10:00:00.000Z',
    composeProjects: 1,
    containers: 2,
    volumes: 1,
    former: 'none',
    selection: null,
  };
}

describe('LoadweaverImportsPageComponent', () => {
  it('lists the hosts under a title bar, opens them through a button and searches', async () => {
    await TestBed.configureTestingModule({
      imports: [LoadweaverImportsPageComponent],
      providers: [
        provideRouter([]),
        { provide: ImportService, useValue: { list: () => of([entry('n1', 'web-1'), entry('n2', 'db-1')]) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoadweaverImportsPageComponent);

    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const open = el.querySelector('[data-testid="imports-list"] a.fpc-data-table__link') as HTMLAnchorElement;

    expect(el.querySelector('fpc-list-header')).toBeNull();
    expect(open.getAttribute('href')).toBe('/operate/imports/n1');
    fixture.componentInstance.open(entry('n1', 'web-1'));
    expect(String(navigate.mock.calls[0][0])).toBe('/operate/imports/n1');

    fixture.componentInstance.search.set('DB-1');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="imports-list"]')?.textContent).not.toContain('web-1');
    expect(el.querySelector('fpc-list-header')).toBeNull();

    fixture.componentInstance.search.set('nothing');
    fixture.detectChanges();
    // No matches replaces the rows; the search sits in the table's toolbar row (3.38 D1).
    expect(el.querySelector('[data-testid="imports-list"] [data-testid="fpc-data-table-no-matches"]')).not.toBeNull();
  });
});
