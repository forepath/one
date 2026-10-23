import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { FleetSite } from '@forepath/loadweaver/frontend/data-access-console';

import { projectSite } from './fleet-format';

/**
 * Coarse continent outlines as `[longitude, latitude]` waypoints. Hand-drawn for this project from rough
 * coordinates (no third-party map data), so they carry the repository's license; they only give the site markers a
 * recognisable backdrop and are deliberately low detail.
 */
// prettier-ignore
export const WORLD_OUTLINES: readonly (readonly [number, number])[][] = [
  // North America
  [
    [-168, 66], [-162, 70], [-140, 70], [-120, 72], [-95, 73], [-80, 70], [-62, 60], [-55, 52], [-66, 45],
    [-75, 38], [-80, 31], [-81, 25], [-90, 29], [-97, 26], [-97, 20], [-90, 16], [-83, 9], [-78, 8], [-86, 13],
    [-105, 20], [-112, 30], [-118, 34], [-124, 40], [-125, 49], [-135, 58], [-150, 60], [-165, 60],
  ],
  // Greenland
  [[-73, 78], [-60, 82], [-30, 83], [-20, 75], [-40, 65], [-50, 62], [-55, 70]],
  // South America
  [
    [-78, 8], [-60, 10], [-50, 0], [-35, -6], [-40, -22], [-48, -28], [-58, -38], [-65, -45], [-68, -55],
    [-75, -50], [-72, -30], [-70, -18], [-80, -5], [-80, 2],
  ],
  // Europe
  [
    [-10, 36], [-9, 43], [-2, 44], [-5, 48], [2, 51], [8, 54], [5, 58], [10, 63], [20, 70], [30, 71], [40, 67],
    [45, 60], [40, 45], [28, 41], [23, 36], [15, 38], [12, 44], [5, 43], [-2, 37],
  ],
  // Great Britain and Ireland
  [[-5, 50], [1, 51], [0, 54], [-3, 58], [-6, 56], [-5, 53]],
  [[-10, 52], [-6, 52], [-6, 55], [-10, 54]],
  // Africa
  [
    [-17, 21], [-10, 30], [-5, 36], [10, 37], [20, 32], [32, 31], [35, 28], [43, 12], [51, 12], [42, -2],
    [40, -15], [35, -25], [20, -35], [17, -29], [12, -17], [13, -5], [9, 4], [-8, 4], [-17, 14],
  ],
  // Madagascar
  [[44, -12], [50, -15], [47, -25], [43, -22]],
  // Asia
  [
    [28, 41], [40, 45], [45, 60], [40, 67], [60, 70], [80, 73], [100, 78], [140, 72], [180, 68], [170, 60],
    [160, 55], [140, 50], [130, 42], [122, 40], [121, 30], [110, 20], [108, 11], [100, 13], [98, 8], [92, 22],
    [80, 15], [77, 8], [72, 20], [62, 25], [56, 26], [50, 30], [48, 29], [55, 22], [52, 15], [43, 12], [35, 28],
    [36, 36],
  ],
  // Japan
  [[130, 31], [141, 36], [142, 43], [145, 44], [140, 41], [135, 34]],
  // Indonesia (coarse)
  [[95, 5], [106, -6], [115, -8], [120, -9], [125, -8], [119, -4], [110, -2], [104, 1]],
  // Australia
  [
    [114, -22], [122, -18], [130, -12], [137, -12], [142, -11], [146, -19], [153, -26], [150, -37], [141, -38],
    [131, -31], [117, -35], [114, -27],
  ],
  // New Zealand
  [[172, -34], [178, -38], [174, -42], [167, -46], [170, -41]],
  // Antarctica
  [[-180, -72], [-90, -70], [0, -69], [90, -67], [180, -72], [180, -85], [-180, -85]],
];

/** SVG path data of an outline in the `0 0 360 180` viewBox. */
export function outlinePath(points: readonly (readonly [number, number])[]): string {
  return (
    points
      .map(([lon, lat], i) => {
        const { x, y } = projectSite(lat, lon);

        return `${i === 0 ? 'M' : 'L'}${x} ${y}`;
      })
      .join(' ') + ' Z'
  );
}

const OUTLINE_PATHS = WORLD_OUTLINES.map(outlinePath);

/**
 * World map of the fleet's sites (3.25): equirectangular, sites with a `Site.spec.location` as markers (title:
 * cluster / site); clicking one opens that cluster. Purely SVG, no map tiles or external requests.
 */
@Component({
  selector: 'loadweaver-fleet-world-map',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 360 180"
      class="d-block w-100 h-auto"
      role="img"
      [attr.aria-label]="ariaLabel()"
      data-testid="fleet-world-map"
    >
      <rect x="0" y="0" width="360" height="180" class="text-body-tertiary" fill="currentColor" fill-opacity="0.15" />
      @for (d of outlines; track $index) {
        <path [attr.d]="d" class="text-body-secondary" fill="currentColor" fill-opacity="0.35" stroke="none" />
      }
      @for (marker of markers(); track marker.key) {
        <g
          class="text-primary"
          role="button"
          tabindex="0"
          [attr.aria-label]="marker.title"
          (click)="siteSelected.emit(marker.site)"
          (keydown.enter)="siteSelected.emit(marker.site)"
          data-testid="fleet-map-site"
        >
          <title>{{ marker.title }}</title>
          <circle [attr.cx]="marker.x" [attr.cy]="marker.y" r="3.5" fill="currentColor" fill-opacity="0.25" />
          <circle [attr.cx]="marker.x" [attr.cy]="marker.y" r="1.6" fill="currentColor" />
        </g>
      }
    </svg>
  `,
})
export class LoadweaverFleetWorldMapComponent {
  readonly sites = input<FleetSite[]>([]);
  readonly ariaLabel = input('World map of sites');
  readonly siteSelected = output<FleetSite>();

  readonly outlines = OUTLINE_PATHS;

  readonly markers = computed(() =>
    this.sites().map((site) => ({
      key: `${site.clusterId}/${site.site}`,
      site,
      title: `${site.clusterName} · ${site.label ?? site.site}`,
      ...projectSite(site.latitude, site.longitude),
    })),
  );
}
