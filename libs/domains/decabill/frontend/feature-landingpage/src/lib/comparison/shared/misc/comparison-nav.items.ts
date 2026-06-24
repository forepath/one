import type { ComparisonSlug } from '../matrix/comparison-matrix.model';

export interface ComparisonNavItem {
  readonly slug: ComparisonSlug;
  readonly label: string;
  readonly routerLink: string;
}

export const PORTAL_COMPARISON_NAV_ITEMS: readonly ComparisonNavItem[] = [
  { slug: 'whmcs', label: $localize`:@@featureDecabillComparison-navWhmcs:WHMCS`, routerLink: '/compare/whmcs' },
  {
    slug: 'hostbill',
    label: $localize`:@@featureDecabillComparison-navHostbill:HostBill`,
    routerLink: '/compare/hostbill',
  },
  {
    slug: 'stripe-billing',
    label: $localize`:@@featureDecabillComparison-navStripe:Stripe Billing`,
    routerLink: '/compare/stripe-billing',
  },
  {
    slug: 'chargebee',
    label: $localize`:@@featureDecabillComparison-navChargebee:Chargebee`,
    routerLink: '/compare/chargebee',
  },
  { slug: 'paddle', label: $localize`:@@featureDecabillComparison-navPaddle:Paddle`, routerLink: '/compare/paddle' },
];
