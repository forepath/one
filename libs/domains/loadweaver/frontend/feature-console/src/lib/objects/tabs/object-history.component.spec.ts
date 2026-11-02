import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ConsoleAuditService, PlansService, type Plan } from '@forepath/loadweaver/frontend/data-access-console';
import { of } from 'rxjs';

import { LoadweaverObjectHistoryComponent } from './object-history.component';

describe('LoadweaverObjectHistoryComponent (3.38)', () => {
  it('shows the plans touching the object as a table (state, link) with icon "Open all" buttons in the lane headers', async () => {
    const plan = {
      id: 'p1',
      status: 'applied',
      createdAt: '2026-10-28T10:00:00.000Z',
      changes: [],
    } as unknown as Plan;

    await TestBed.configureTestingModule({
      imports: [LoadweaverObjectHistoryComponent],
      providers: [
        provideRouter([]),
        { provide: PlansService, useValue: { list: jest.fn(() => of([plan])) } },
        { provide: ConsoleAuditService, useValue: { list: jest.fn(() => of({ entries: [] })) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoadweaverObjectHistoryComponent);

    fixture.componentRef.setInput('ref', { kind: 'project', project: null, name: 'shop' });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="history-plans"]')?.textContent).toContain('Plans touching this object');
    expect(
      el
        .querySelector('[data-testid="history-plans"] [data-testid="fpc-data-table-state"]')
        ?.getAttribute('aria-label'),
    ).toBe('Applied');
    expect(el.querySelector('[data-testid="history-plans"] a.fpc-data-table__link')?.getAttribute('href')).toBe(
      '/activity/plans/p1',
    );
    expect(el.querySelector('[data-testid="history-plans-open-all"] button')?.getAttribute('aria-label')).toBe(
      'Open all plans',
    );
    expect(el.querySelector('[data-testid="history-audit"] fpc-empty-state')?.textContent).toContain('No events yet');
    expect(el.querySelector('[data-testid="history-plans"] fpc-lane-header fpc-badge')).toBeNull(); // no total (D8)
  });
});
