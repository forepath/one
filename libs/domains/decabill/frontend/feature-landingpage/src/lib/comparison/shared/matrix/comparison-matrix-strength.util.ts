import type { MatrixStrength } from './comparison-matrix.model';

export interface MatrixStrengthVisual {
  readonly iconClass: string;
  readonly colorClass: string;
  readonly label: string;
}

export function matrixStrengthVisual(strength: MatrixStrength): MatrixStrengthVisual {
  switch (strength) {
    case 'strong':
      return {
        iconClass: 'bi-check-circle',
        colorClass: 'text-success',
        label: $localize`:@@featureDecabillComparison-matrixLabelStrong:Strong fit`,
      };
    case 'partial':
      return {
        iconClass: 'bi-exclamation-circle',
        colorClass: 'text-warning',
        label: $localize`:@@featureDecabillComparison-matrixLabelPartial:Partial / gaps`,
      };
    case 'weak':
      return {
        iconClass: 'bi-x-circle',
        colorClass: 'text-danger',
        label: $localize`:@@featureDecabillComparison-matrixLabelWeak:Weak / not a focus`,
      };
    case 'na':
      return {
        iconClass: 'bi-x-circle',
        colorClass: 'text-secondary',
        label: $localize`:@@featureDecabillComparison-matrixLabelNa:Not applicable`,
      };
  }
}
