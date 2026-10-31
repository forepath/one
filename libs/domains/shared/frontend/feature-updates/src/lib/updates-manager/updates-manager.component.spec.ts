import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  AdminUpdatesFacade,
  UPDATES_ADMIN_ENVIRONMENT,
  type UpdatesFullState,
} from '@forepath/shared/frontend/data-access-updates';
import { BehaviorSubject } from 'rxjs';

import { fpcIsContainerHostname, UpdatesManagerComponent } from './updates-manager.component';

function fullState(overrides: Partial<UpdatesFullState> = {}): UpdatesFullState {
  return {
    installedVersion: '1.1.0',
    latestVersion: '1.2.0-beta.1',
    updateState: 'update_available',
    lastCheckAt: '2026-10-01T10:00:00.000Z',
    lastCheckStatus: 'success',
    instanceCount: 0,
    outdatedInstanceCount: 0,
    release: null,
    instances: [],
    scopedChangelog: { product: [], shared: [] },
    ...overrides,
  };
}

describe('UpdatesManagerComponent', () => {
  let fixture: ComponentFixture<UpdatesManagerComponent>;
  let facade: Record<string, unknown>;

  beforeAll(() => {
    // jsdom has no matchMedia (the summary bar watches breakpoints).
    if (!window.matchMedia) {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (query: string) => ({
          matches: false,
          media: query,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => false,
        }),
      });
    }
  });

  async function setup(state: UpdatesFullState) {
    facade = {
      fullState$: new BehaviorSubject(state),
      fullLoading$: new BehaviorSubject(false),
      checking$: new BehaviorSubject(false),
      error$: new BehaviorSubject(null),
      scopedChangelog$: new BehaviorSubject(state.scopedChangelog),
      instances$: new BehaviorSubject(state.instances),
      loadFull: jest.fn(),
      triggerCheck: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [UpdatesManagerComponent],
      providers: [
        { provide: AdminUpdatesFacade, useValue: facade },
        { provide: UPDATES_ADMIN_ENVIRONMENT, useValue: { apiUrl: 'https://api.example.com', updatesBasePath: 'u' } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UpdatesManagerComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('shows no channel and no beta badge for products without channels', async () => {
    await setup(fullState({ latestVersion: '1.2.0' }));

    expect(facade['loadFull']).toHaveBeenCalled();
    expect(el().querySelector('[data-testid="updates-channel"]')).toBeNull();
    expect(el().querySelector('[data-testid="updates-prerelease"]')).toBeNull();
    expect(fixture.componentInstance.summaryCardCount()).toBe(3);
  });

  it('shows the channel and marks a prerelease', async () => {
    await setup(
      fullState({
        channel: 'beta',
        release: {
          tagName: 'v1.2.0-beta.1',
          name: '1.2.0-beta.1',
          body: '',
          htmlUrl: 'https://github.com/forepath/one/releases/tag/v1.2.0-beta.1',
          publishedAt: '2026-10-01T10:00:00.000Z',
          changelog: [],
          scopedChangelog: { product: [], shared: [] },
          prerelease: true,
        },
      }),
    );

    expect(el().querySelector('[data-testid="updates-channel"]')?.textContent).toContain('Beta');
    expect(el().querySelector('[data-testid="updates-prerelease"]')?.textContent).toContain('Beta');
    expect(fixture.componentInstance.summaryCardCount()).toBe(4);
    expect(fixture.componentInstance.channelName('stable')).toBe('Stable');
  });

  it('lists instances as a table with readable values and no raw instance id', async () => {
    await setup(
      fullState({
        instances: [
          {
            instanceId: '8f3a2c1e-0000-4000-8000-000000000001',
            serviceName: 'agent-controller',
            hostname: 'node-1',
            installedVersion: '1.1.0',
            role: 'worker',
            updateState: 'update_available',
            lastHeartbeatAt: '2026-10-01T10:00:00.000Z',
            dependencies: { redis: 'healthy', queue: 'degraded', database: 'healthy', opensearch: 'not_applicable' },
          } as never,
        ],
      }),
    );

    const table = el().querySelector('[data-testid="updates-instances-table"]');

    expect(table?.textContent).toContain('Agent controller');
    expect(table?.textContent).toContain('Worker');
    expect(table?.textContent).not.toContain('8f3a2c1e');
    expect(fixture.componentInstance.updateTableState('update_available').label).toBe('Update available');
  });

  it('hides generated container hostnames (D11) and keeps real host names', async () => {
    await setup(fullState({ latestVersion: '1.2.0' }));
    expect(fpcIsContainerHostname('ba6e3edfade7')).toBe(true);
    expect(fpcIsContainerHostname('node-1')).toBe(false);
    expect(fixture.componentInstance.hostLabel('ba6e3edfade7')).toBe('—');
    expect(fixture.componentInstance.hostLabel('node-1')).toBe('node-1');
  });

  it('shows the changelog in its own tab with readable categories', async () => {
    await setup(
      fullState({
        scopedChangelog: { product: [{ text: 'New dashboard', scope: 'product', category: 'feat' }], shared: [] },
      }),
    );

    fixture.componentInstance.onMobilePanelTabChange('product');
    fixture.detectChanges();

    const table = el().querySelector('[data-testid="updates-changelog-product-table"]');

    expect(table?.textContent).toContain('New dashboard');
    expect(fixture.componentInstance.changelogCategoryState('feat').label).toBe('Features');
  });
  it('maps emoji-prefixed release-note sections to their category ("⚠ Breaking Changes")', () => {
    const state = fixture.componentInstance.changelogCategoryState('⚠ Breaking Changes');

    expect(state.tone).toBe('danger');
    expect(state.icon).toBe('exclamation-octagon');
  });
});
