import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { FleetSite } from '@forepath/loadweaver/frontend/data-access-console';

import { LoadweaverFleetWorldMapComponent, mapMarkers, MARKER_SIZE } from './fleet-world-map.component';

function site(name: string, latitude: number, longitude: number, clusterName = 'alpha'): FleetSite {
  return { clusterId: `id-${clusterName}`, clusterName, site: name, latitude, longitude, label: null };
}

describe('fleet world map', () => {
  describe('mapMarkers', () => {
    it('places single sites at their projected spot (percent of the map)', () => {
      const [fra] = mapMarkers([{ ...site('fra1', 50.11, 8.68), label: 'Frankfurt' }], 360);

      expect(fra.title).toBe('Frankfurt · alpha');
      expect(fra.coordinates).toBe('50.11° N, 8.68° E');
      expect(fra.left).toBeCloseTo((188.7 / 360) * 100, 5);
      expect(fra.top).toBeCloseTo((33.9 / 144) * 100, 5);
      expect([fra.dx, fra.dy, fra.group]).toEqual([0, 0, 1]);
      expect(fra.cssLeft).toBe(`clamp(0px, calc(${fra.left}% + -6px), calc(100% - 12px))`);
    });

    it('spreads sites that would overlap at the rendered width around their shared spot', () => {
      const sites = [site('fra1', 50.11, 8.68), site('fra2', 50.12, 8.7, 'beta'), site('lhr1', 51.5, -0.12)];
      // Narrow map (~1 px per degree): London is within one marker of Frankfurt.
      const narrow = mapMarkers(sites, 360);

      expect(narrow.map((m) => m.group)).toEqual([3, 3, 3]);
      for (const m of narrow) expect(Math.hypot(m.dx, m.dy)).toBeGreaterThanOrEqual(MARKER_SIZE);
      // Neighbours on the ring do not touch.
      expect(Math.hypot(narrow[0].dx - narrow[1].dx, narrow[0].dy - narrow[1].dy)).toBeGreaterThanOrEqual(MARKER_SIZE);

      // Wide map (~4 px per degree): London stands alone, the two Frankfurt sites still share a spot.
      const wide = mapMarkers(sites, 1440);
      const byName = Object.fromEntries(wide.map((m) => [m.site.site, m]));

      expect(byName['lhr1'].group).toBe(1);
      expect(byName['fra1'].group).toBe(2);
      expect(byName['fra1'].left).toBe(byName['fra2'].left);
      expect([byName['fra1'].dx, byName['fra1'].dy]).toEqual([0, -MARKER_SIZE]);
      expect([byName['fra2'].dx, byName['fra2'].dy]).toEqual([0, MARKER_SIZE]);
    });
  });

  describe('LoadweaverFleetWorldMapComponent', () => {
    let fixture: ComponentFixture<LoadweaverFleetWorldMapComponent>;
    let el: HTMLElement;

    beforeEach(async () => {
      await TestBed.configureTestingModule({ imports: [LoadweaverFleetWorldMapComponent] }).compileComponents();
      fixture = TestBed.createComponent(LoadweaverFleetWorldMapComponent);
      fixture.componentRef.setInput('sites', [
        { ...site('fra1', 50.11, 8.68), label: 'Frankfurt' },
        site('sin1', 1.35, 103.82, 'beta'),
      ]);
      fixture.componentRef.setInput('ariaLabel', 'Sites map');
      fixture.detectChanges();
      el = fixture.nativeElement as HTMLElement;
    });

    it('renders the backdrop and one button per site', () => {
      const map = el.querySelector('[data-testid="fleet-world-map"]');

      expect(map?.getAttribute('aria-label')).toBe('Sites map');
      expect(map?.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 360 144');
      expect(map?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');

      const buttons = el.querySelectorAll<HTMLButtonElement>('button[data-testid="fleet-map-site"]');

      expect(buttons).toHaveLength(2);
      expect(buttons[0].getAttribute('aria-label')).toBe('Frankfurt · alpha, 50.11° N, 8.68° E');
      expect(buttons[0].type).toBe('button');
    });

    it('shows the site in a tooltip on focus and emits it on click', () => {
      const selected: FleetSite[] = [];

      fixture.componentInstance.siteSelected.subscribe((s) => selected.push(s));

      const button = el.querySelectorAll<HTMLButtonElement>('[data-testid="fleet-map-site"]')[1];

      button.dispatchEvent(new FocusEvent('focus'));
      fixture.detectChanges();

      const tip = el.querySelector('[data-testid="fleet-map-tip"]');

      expect(tip?.textContent).toContain('sin1 · beta');
      expect(tip?.textContent).toContain('1.35° N, 103.82° E');
      expect(button.getAttribute('aria-describedby')).toBe(tip?.id);

      button.click();
      expect(selected.map((s) => s.site)).toEqual(['sin1']);

      button.dispatchEvent(new FocusEvent('blur'));
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="fleet-map-tip"]')).toBeNull();
    });
  });
});
