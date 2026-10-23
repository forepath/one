import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  AdminUpdatesFacade,
  UPDATES_ADMIN_ENVIRONMENT,
  type UpdatesFullState,
} from '@forepath/shared/frontend/data-access-updates';
import { BehaviorSubject } from 'rxjs';

import { UpdatesManagerComponent } from './updates-manager.component';

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
});
