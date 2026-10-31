import { AlertsService } from '@forepath/loadweaver/frontend/data-access-console';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { ConsoleAccessFacade, ConsoleAlertsFacade } from '@forepath/loadweaver/frontend/data-access-console';
import { Actions } from '@ngrx/effects';
import { Subject } from 'rxjs';

import { LoadweaverAlertSilencesLaneComponent } from '../alerts/alert-silences-lane.component';
import { accessStub, facadeStub } from '../testing';
import {
  LoadweaverMasterDetailComponent,
  LoadweaverMasterDetailEmptyComponent,
  MasterDetailState,
} from './master-detail.component';

@Component({
  selector: 'loadweaver-test-list',
  standalone: true,
  template: `<p data-testid="list">open: {{ state?.selectedId() }}</p>`,
})
class ListStubComponent {
  readonly state = inject(MasterDetailState, { optional: true });
}

@Component({ selector: 'loadweaver-test-detail', standalone: true, template: `<p data-testid="detail">detail</p>` })
class DetailStubComponent {}

@Component({ selector: 'loadweaver-test-summary', standalone: true, template: `<p data-testid="kpis">kpis</p>` })
class SummaryStubComponent {}

@Component({
  selector: 'loadweaver-test-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class RootComponent {}

describe('LoadweaverMasterDetailComponent (3.37 P6)', () => {
  async function setup(empty?: unknown, summary?: unknown, fill = false) {
    TestBed.configureTestingModule({
      providers: [
        // The silences lane injects AlertsService (bulk actions); this spec only renders it.
        { provide: AlertsService, useValue: {} },
        provideRouter([
          { path: 'other', component: DetailStubComponent },
          {
            path: 'items',
            component: LoadweaverMasterDetailComponent,
            data: {
              list: ListStubComponent,
              emptyTitle: 'Pick one',
              ...(empty ? { empty } : {}),
              ...(summary ? { summary } : {}),
              ...(fill ? { fill } : {}),
            },
            children: [
              { path: '', component: LoadweaverMasterDetailEmptyComponent },
              { path: ':id', component: DetailStubComponent },
            ],
          },
        ]),
        {
          provide: ConsoleAlertsFacade,
          useValue: facadeStub(
            {
              silences$: [
                { id: 's1', reason: 'maintenance', startsAt: '2000-01-01T00:00:00Z', endsAt: '2999-01-01T00:00:00Z' },
                { id: 's2', reason: 'old', startsAt: '2000-01-01T00:00:00Z', endsAt: '2000-01-02T00:00:00Z' },
              ],
              silencesLoading$: false,
              silencesError$: null,
              endingSilence$: null,
              silenceSaving$: false,
              actionError$: null,
            },
            ['loadSilences', 'endSilence', 'createSilence', 'clearActionError'],
          ),
        },
        // The silences lane (3.38) offers New silence for the caller's projects.
        { provide: ConsoleAccessFacade, useValue: accessStub({ userId: 'u', clusterRole: null, projects: {} }) },
        { provide: Actions, useValue: new Subject() },
      ],
    });

    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(RootComponent);

    return { router, fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('shows the list with the empty hint, then list + detail with the open id', async () => {
    const { router, fixture, el } = await setup();

    await router.navigateByUrl('/items');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const shell = el.querySelector('loadweaver-master-detail') as HTMLElement;

    expect(el.querySelector('[data-testid="list"]')?.textContent).toContain('open:');
    expect(el.querySelector('[data-testid="master-detail-empty"]')).not.toBeNull();
    expect(shell.classList.contains('lw-md--detail')).toBe(false);

    await router.navigateByUrl('/items/42');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('[data-testid="detail"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="list"]')?.textContent).toContain('open: 42');
    expect(shell.classList.contains('lw-md--detail')).toBe(true);
  });

  it('enters the shell from another route (child routes not advanced yet while it is created)', async () => {
    const { router, fixture, el } = await setup();
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };

    // Section tab switch (Plans → Drafts, Audit → Plans): the shell is created while its `:id` / '' child route has
    // no snapshot yet — reading `snapshot.paramMap` there threw and the navigation died (blank page).
    await router.navigateByUrl('/other');
    await settle();
    expect(await router.navigateByUrl('/items')).toBe(true);
    await settle();
    expect(el.querySelector('[data-testid="list"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="master-detail-empty"]')).not.toBeNull();

    await router.navigateByUrl('/other');
    await settle();
    expect(await router.navigateByUrl('/items/7')).toBe(true);
    await settle();
    expect(el.querySelector('[data-testid="list"]')?.textContent).toContain('open: 7');
    expect(el.querySelector('loadweaver-master-detail')?.classList.contains('lw-md--detail')).toBe(true);
  });

  it('renders the `empty` component (Alerts: current silences) while nothing is open', async () => {
    const { router, fixture, el } = await setup(LoadweaverAlertSilencesLaneComponent);

    await router.navigateByUrl('/items');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const lane = el.querySelector('[data-testid="alert-silences-lane"]');

    expect(lane?.textContent).toContain('maintenance');
    expect(lane?.textContent).not.toContain('old');
  });

  it('renders the optional summary above the list / detail row (full width)', async () => {
    const { router, fixture, el } = await setup(undefined, SummaryStubComponent);

    await router.navigateByUrl('/items');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const summary = el.querySelector('[data-testid="master-detail-summary"]') as HTMLElement;

    expect(summary.querySelector('[data-testid="kpis"]')).not.toBeNull();
    expect(summary.nextElementSibling?.classList).toContain('lw-md__row');
    expect(el.querySelector('.lw-md__row [data-testid="master-detail-list"]')).not.toBeNull();
  });

  it('lets a `fill` list take the row until an entry opens (Updates lanes)', async () => {
    const { router, fixture, el } = await setup(undefined, undefined, true);
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };

    await router.navigateByUrl('/items');
    await settle();

    const shell = el.querySelector('loadweaver-master-detail') as HTMLElement;

    expect(shell.classList.contains('lw-md--fill')).toBe(true);

    await router.navigateByUrl('/items/3');
    await settle();
    expect(shell.classList.contains('lw-md--fill')).toBe(false);
    expect(shell.classList.contains('lw-md--detail')).toBe(true);
  });
});
