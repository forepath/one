import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { ConsoleBackupsFacade } from '@forepath/loadweaver/frontend/data-access-console';
import { BehaviorSubject } from 'rxjs';

import type { ConsoleNavItem } from '../console-nav';
import { ConsoleNavService } from '../nav/console-nav.service';
import { ConsoleSettingsService } from '../nav/console-settings.service';
import { LoadweaverSectionPageComponent, sectionNavWidth } from './section-page.component';

@Component({ standalone: true, template: '<p class="child">child</p>' })
class ChildComponent {}

describe('LoadweaverSectionPageComponent', () => {
  const items: ConsoleNavItem[] = [
    { path: '/observe/health', icon: 'bi-heart-pulse', label: 'Health', title: 'Health', heading: 'Health & alerts' },
    { path: '/observe/alerts', icon: 'bi-bell', label: 'Alerts', title: 'Alerts', heading: 'Health & alerts' },
    { path: '/observe/logs', icon: 'bi-journal-text', label: 'Logs', title: 'Logs', heading: 'Telemetry' },
  ];
  const url = signal('/observe/alerts/a1');
  const openDeletions$ = new BehaviorSubject<unknown[]>([]);
  const backups = { openDeletions$, loadDeletions: jest.fn() };
  const settings = { state: signal<Record<string, unknown>>({ sectionNavWidth: 320 }), patch: jest.fn() };

  async function setup(sectionItems = items) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: ChildComponent }]),
        { provide: ConsoleBackupsFacade, useValue: backups },
        { provide: ConsoleSettingsService, useValue: settings },
        { provide: ActivatedRoute, useValue: { snapshot: { data: { section: 'observe' } } } },
        {
          provide: ConsoleNavService,
          useValue: {
            url,
            sectionItems: () => sectionItems,
            section: () => ({ id: 'observe', title: 'Observe' }),
          },
        },
      ],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/observe/alerts/a1');
    const fixture = TestBed.createComponent(LoadweaverSectionPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, router, host: fixture.nativeElement as HTMLElement };
  }

  it('renders the sub-nav with headings and marks the active page', async () => {
    const { fixture, host } = await setup();

    expect(fixture.componentInstance.activePath()).toBe('/observe/alerts');
    const tabs = Array.from(host.querySelectorAll('.fpc-tab-group__bar [role="tab"]'));
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['Health', 'Alerts', 'Logs']);
    expect(host.querySelectorAll('.fpc-tab-group__section-title')).toHaveLength(2);
    expect(host.querySelector('.fpc-tab-group__bar [role="tab"].active')?.textContent).toContain('Alerts');
  });

  it('puts the sub-nav in a resizable left column beside the page, with the width per user', async () => {
    const { fixture, host } = await setup();
    const start = host.querySelector('fpc-split-pane .fpc-split-pane__pane--start');
    const end = host.querySelector('fpc-split-pane .fpc-split-pane__pane--end');

    expect(start?.querySelector('[data-testid="console-section-nav"]')).not.toBeNull();
    expect(end?.querySelector('router-outlet')).not.toBeNull();
    expect(host.querySelector('fpc-tab-group')?.classList).toContain('fpc-tab-group--stretch');
    expect(fixture.componentInstance.navWidth()).toBe(320);
    expect(host.querySelector('[data-testid="fpc-split-pane-gutter"]')).not.toBeNull();

    jest.useFakeTimers();
    fixture.componentInstance.onWidth(300);
    fixture.componentInstance.onWidth(360);
    jest.advanceTimersByTime(500);
    expect(settings.patch).toHaveBeenCalledTimes(1);
    expect(settings.patch).toHaveBeenCalledWith({ sectionNavWidth: 360 });
    jest.useRealTimers();
  });

  it('clamps the stored width to the tree bounds', () => {
    expect(sectionNavWidth(undefined)).toBe(240);
    expect(sectionNavWidth('wide')).toBe(240);
    expect(sectionNavWidth(100)).toBe(240);
    expect(sectionNavWidth(999)).toBe(480);
    expect(sectionNavWidth(301.4)).toBe(301);
  });

  it('navigates from the sub-nav and the phone select', async () => {
    const { fixture, router, host } = await setup();
    const navigate = jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    (host.querySelectorAll('.fpc-tab-group__bar [role="tab"]')[2] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(navigate).toHaveBeenCalledWith('/observe/logs');

    const select = host.querySelector('[data-testid="console-section-select"] select') as HTMLSelectElement;
    select.value = '/observe/health';
    select.dispatchEvent(new Event('change'));
    expect(navigate).toHaveBeenCalledWith('/observe/health');
  });

  it('hides the sub-nav for a single page', async () => {
    const { host } = await setup(items.slice(0, 1));

    expect(host.querySelector('[data-testid="console-section-nav"]')).toBeNull();
    expect(host.querySelector('[data-testid="console-section-select"]')).toBeNull();
    // No column: the page takes the full width.
    expect(host.querySelector('[data-testid="fpc-split-pane-gutter"]')).toBeNull();
  });

  it('shows the open deletion requests as a badge on the Deletions item', async () => {
    const deletions: ConsoleNavItem = {
      path: '/operate/backups/deletions',
      icon: 'bi-trash',
      label: 'Deletions',
      title: 'Deletions',
      badge: 'backup-deletions',
    };

    openDeletions$.next([{ id: 'd1' }, { id: 'd2' }]);
    const { fixture, host } = await setup([items[0], deletions]);

    expect(backups.loadDeletions).toHaveBeenCalledWith(true);
    expect(fixture.componentInstance.badge(deletions)).toBe(2);
    expect(host.querySelector('.fpc-tab-group__badge')?.textContent?.trim()).toBe('2');
  });
});
