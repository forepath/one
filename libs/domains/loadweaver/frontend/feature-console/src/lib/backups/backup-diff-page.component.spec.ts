import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ConsoleBackupsFacade } from '@forepath/loadweaver/frontend/data-access-console';
import { of } from 'rxjs';

import { facadeStub, testBackup } from '../testing';
import { LoadweaverBackupDiffPageComponent } from './backup-diff-page.component';

describe('LoadweaverBackupDiffPageComponent', () => {
  async function setup() {
    const from = testBackup({ id: 'b0', startedAt: '2026-09-30T10:00:00.000Z' });
    const to = testBackup({ id: 'b1' });
    const facade = facadeStub(
      {
        diff$: {
          loading: false,
          error: null,
          result: {
            from,
            to,
            diff: {
              added: [{ path: 'new.txt', size: 10, directory: false }],
              removed: [{ path: 'old', size: null, directory: true }],
              changed: [{ path: 'a.txt', before: 1, after: 3 }],
              stats: null,
            },
          },
        },
      },
      ['compare'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverBackupDiffPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({ from: 'b0', to: 'b1' })) } },
        { provide: ConsoleBackupsFacade, useValue: facade },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoadweaverBackupDiffPageComponent);

    fixture.detectChanges();

    return { facade, el: fixture.nativeElement as HTMLElement };
  }

  it('compares the pair, shows it in the header context and lists the changes as one grouped table', async () => {
    const { facade, el } = await setup();

    expect(facade['compare']).toHaveBeenCalledWith('b0', 'b1');
    expect(el.querySelector('[data-testid="backup-diff-pair"]')?.closest('fpc-page-header')).not.toBeNull();
    expect(el.querySelector('[data-testid="backup-diff-back"]')?.getAttribute('href')).toBe('/operate/backups');
    expect(el.querySelector('ul.list-group')).toBeNull();
    const table = el.querySelector('[data-testid="backup-diff-changes"]');

    expect(table?.querySelectorAll('[data-testid="fpc-data-table-group"]')).toHaveLength(3);
    expect(table?.textContent).toContain('new.txt');
    expect(table?.textContent).toContain('old/');
    expect(table?.textContent).toContain('+2 B');
    expect(
      [...(table?.querySelectorAll('[data-testid="fpc-data-table-state"]') ?? [])].map((s) =>
        s.getAttribute('aria-label'),
      ),
    ).toEqual(['Added', 'Removed', 'Changed']);
  });
});
