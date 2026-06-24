import type { ComparisonPageConfig } from '../shared/misc/comparison-page.model';
import { COMPARISON_TECHNOLOGY_FIT_LEAD } from '../shared/misc/comparison-technology-fit-lead';

export const WHMCS_COMPARISON_PAGE: ComparisonPageConfig = {
  slug: 'whmcs',
  competitorDisplayName: 'WHMCS',
  metaTitle: $localize`:@@featureDecabillComparison-whmcs-metaTitle:WHMCS vs Decabill`,
  metaDescription: $localize`:@@featureDecabillComparison-whmcs-metaDescription:Compare WHMCS hosting automation with Decabill's unified billing for SaaS, agency services, managed hosting, ZUGFeRD invoicing, and multi-tenant operations.`,
  canonicalUrl: 'https://decabill.com/compare/whmcs',
  heroSubtitle: $localize`:@@featureDecabillComparison-whmcs-heroSubtitle:Classic hosting panel automation versus unified billing for SaaS, services, and cloud infrastructure.`,
  overviewCompetitorLead: $localize`:@@featureDecabillComparison-whmcs-overviewCompetitor:WHMCS is the long-standing control panel for hosting providers. It automates orders, domains, shared hosting, and client billing in a PHP stack many resellers already know. It fits when your business is primarily classic hosting and you want a mature panel ecosystem with modules and community extensions.`,
  overviewDecabillLead: $localize`:@@featureDecabillComparison-whmcs-overviewDecabill:Decabill is built for agencies and digital product teams that bill more than hosting alone. It unifies SaaS subscriptions, service work, and managed cloud hosting in one multi-tenant platform with ZUGFeRD invoicing, Stripe payments, and operator consoles you can self-host or run on Decabill Cloud.`,
  technologyFitLead: COMPARISON_TECHNOLOGY_FIT_LEAD,
};
