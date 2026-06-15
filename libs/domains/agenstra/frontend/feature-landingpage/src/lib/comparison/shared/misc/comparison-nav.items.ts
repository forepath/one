import type { ComparisonSlug } from '../matrix/comparison-matrix.model';

export interface ComparisonNavItem {
  readonly slug: ComparisonSlug;
  readonly label: string;
  readonly routerLink: string;
}

export const PORTAL_COMPARISON_NAV_ITEMS: readonly ComparisonNavItem[] = [
  { slug: 'devin', label: $localize`:@@featurePortalComparison-navDevin:Devin`, routerLink: '/compare/devin' },
  { slug: 'cursor', label: $localize`:@@featurePortalComparison-navCursor:Cursor`, routerLink: '/compare/cursor' },
  {
    slug: 'github-copilot',
    label: $localize`:@@featurePortalComparison-navCopilot:GitHub Copilot`,
    routerLink: '/compare/github-copilot',
  },
  {
    slug: 'codeium-windsurf',
    label: $localize`:@@featurePortalComparison-navCodeium:Codeium / Windsurf`,
    routerLink: '/compare/codeium-windsurf',
  },
  {
    slug: 'tabnine-enterprise',
    label: $localize`:@@featurePortalComparison-navTabnine:Tabnine Enterprise`,
    routerLink: '/compare/tabnine-enterprise',
  },
  { slug: 'portkey', label: $localize`:@@featurePortalComparison-navPortkey:Portkey`, routerLink: '/compare/portkey' },
  { slug: 'orq-ai', label: $localize`:@@featurePortalComparison-navOrq:Orq.ai`, routerLink: '/compare/orq-ai' },
];
