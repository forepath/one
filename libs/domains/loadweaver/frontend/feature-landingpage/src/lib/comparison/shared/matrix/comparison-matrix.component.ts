import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { buildComparisonMatrixRows } from './comparison-matrix-data';
import { matrixStrengthVisual } from './comparison-matrix-strength.util';
import type { ComparisonSlug } from './comparison-matrix.model';

@Component({
  selector: 'loadweaver-portal-comparison-matrix',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './comparison-matrix.component.html',
  styleUrl: './comparison-matrix.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalComparisonMatrixComponent {
  readonly slug = input.required<ComparisonSlug>();
  readonly competitorColumnLabel = input.required<string>();

  protected readonly matrixStrengthVisual = matrixStrengthVisual;
  protected readonly rows = computed(() => buildComparisonMatrixRows(this.slug()));
  /** Accessible name of the table (a visually hidden caption would overflow the rounded frame by 1px). */
  protected readonly tableLabel = computed(
    () =>
      $localize`:@@featureLoadweaverComparison-matrixCaption:Capabilities of Loadweaver compared with ${this.competitorColumnLabel()}:competitor:`,
  );
}
