import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { FpcButtonComponent } from '@forepath/shared/frontend/ui-components';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ConsoleEndpointService } from '@forepath/loadweaver/frontend/data-access-console';

import { LoadweaverFleetUnavailablePageComponent } from './fleet-unavailable-page.component';

describe('LoadweaverFleetUnavailablePageComponent', () => {
  let fixture: ComponentFixture<LoadweaverFleetUnavailablePageComponent>;

  function render(page: string | null, endpoint: string | null = 'https://cp.example.com') {
    TestBed.configureTestingModule({
      imports: [LoadweaverFleetUnavailablePageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(page ? { page } : {}) } },
        },
        {
          provide: ConsoleEndpointService,
          useValue: {
            nativeConsoleUrl: (path: string) => (endpoint ? `${endpoint}${path}` : null),
            activeClusterId: () => '11111111-1111-4111-8111-111111111111',
          },
        },
      ],
    });

    fixture = TestBed.createComponent(LoadweaverFleetUnavailablePageComponent);

    fixture.detectChanges();

    return fixture.nativeElement as HTMLElement;
  }

  it('explains the decided native page precisely and links to the cluster console', () => {
    const el = render('/access/devices');

    expect(el.querySelector('[data-testid="fleet-unavailable"]')?.textContent).toContain('VPN devices');
    // An empty-state action button (3.38), not a raw outline link.
    const native = fixture.debugElement.query(By.css('[data-testid="fleet-unavailable-native"]'));

    expect(native.parent?.nativeElement.hasAttribute('fpcEmptyStateActions')).toBe(true);
    expect((native.componentInstance as FpcButtonComponent).href()).toBe('https://cp.example.com/access/devices');
  });

  it('has no native link while the endpoint is unknown; trusted fleets point to the fleet’s cluster page', () => {
    const el = render('/settings/trusted-fleets', null);

    expect(el.querySelector('[data-testid="fleet-unavailable"]')?.textContent).toContain("fleet's cluster page");
    expect(el.querySelector('[data-testid="fleet-unavailable-native"]')).toBeNull();
    expect(fixture.componentInstance.clusterPage).toEqual(['/fleet/clusters', '11111111-1111-4111-8111-111111111111']);
    expect(el.querySelector('[data-testid="fleet-unavailable-trust"]')).not.toBeNull();
  });

  it('never turns another page parameter into a link', () => {
    const el = render('//evil.example.com');

    expect(el.querySelector('[data-testid="fleet-unavailable"]')?.textContent).toContain("cluster's own console");
    expect(el.querySelector('[data-testid="fleet-unavailable-native"]')).toBeNull();
  });
});
