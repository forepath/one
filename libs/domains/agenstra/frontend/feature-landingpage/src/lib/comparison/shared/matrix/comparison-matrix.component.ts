import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { buildComparisonMatrixRows } from './comparison-matrix-data';
import { matrixStrengthVisual } from './comparison-matrix-strength.util';
import type { ComparisonMatrixRowViewModel, ComparisonSlug } from './comparison-matrix.model';

@Component({
  selector: 'framework-portal-comparison-matrix',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './comparison-matrix.component.html',
  styleUrl: './comparison-matrix.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalComparisonMatrixComponent {
  @Input({ required: true }) slug!: ComparisonSlug;

  @Input({ required: true }) competitorColumnLabel!: string;

  readonly matrixStrengthVisual = matrixStrengthVisual;

  get rows(): ComparisonMatrixRowViewModel[] {
    return buildComparisonMatrixRows(this.slug);
  }
}
