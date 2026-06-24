import type { ComparisonPageConfig } from '../shared/misc/comparison-page.model';
import { COMPARISON_TECHNOLOGY_FIT_LEAD } from '../shared/misc/comparison-technology-fit-lead';

export const HOSTBILL_COMPARISON_PAGE: ComparisonPageConfig = {
  slug: 'hostbill',
  competitorDisplayName: 'HostBill',
  metaTitle: $localize`:@@featureDecabillComparison-hostbill-metaTitle:HostBill vs Decabill`,
  metaDescription: $localize`:@@featureDecabillComparison-hostbill-metaDescription:Compare HostBill hosting automation with Decabill for agencies that mix SaaS, projects, managed hosting, EU invoicing, and self-hosted multi-tenant billing.`,
  canonicalUrl: 'https://decabill.com/compare/hostbill',
  heroSubtitle: $localize`:@@featureDecabillComparison-hostbill-heroSubtitle:Licensed hosting automation versus open billing for agencies that mix SaaS, projects, and managed hosting.`,
  overviewCompetitorLead: $localize`:@@featureDecabillComparison-hostbill-overviewCompetitor:HostBill targets hosting and domain providers with deep automation for shared hosting, VPS, and email platforms. It offers a licensed self-hosted panel with modules for provisioning and client management. It fits when your core business is traditional hosting resale and you want a polished panel with lifetime licensing options.`,
  overviewDecabillLead: $localize`:@@featureDecabillComparison-hostbill-overviewDecabill:Decabill gives operators one revenue home for subscriptions, agency services, and cloud-backed hosting. You get customer and admin consoles, ZUGFeRD invoicing, Hetzner and DigitalOcean provisioning, and a multi-tenant model designed for teams that sell across more than one product line.`,
  technologyFitLead: COMPARISON_TECHNOLOGY_FIT_LEAD,
};
