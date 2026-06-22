import type { ComparisonPageConfig } from '../shared/misc/comparison-page.model';
import { COMPARISON_TECHNOLOGY_FIT_LEAD } from '../shared/misc/comparison-technology-fit-lead';

export const PADDLE_COMPARISON_PAGE: ComparisonPageConfig = {
  slug: 'paddle',
  competitorDisplayName: 'Paddle',
  metaTitle: $localize`:@@featureDecabillComparison-paddle-metaTitle:Paddle vs Decabill`,
  metaDescription: $localize`:@@featureDecabillComparison-paddle-metaDescription:Compare Paddle merchant-of-record billing with Decabill for operators who want their own PSP relationships, self-hosted billing, hosting lifecycle, and German EU invoicing compliance.`,
  canonicalUrl: 'https://decabill.com/compare/paddle',
  heroSubtitle: $localize`:@@featureDecabillComparison-paddle-heroSubtitle:Merchant-of-record SaaS versus billing you operate with your own payment and hosting stack.`,
  overviewCompetitorLead: $localize`:@@featureDecabillComparison-paddle-overviewCompetitor:Paddle acts as merchant of record for SaaS and digital products. It handles checkout, global tax compliance, and subscription management while abstracting payment complexity behind Paddle's vendor relationship. It fits when you want to outsource tax remittance and MoR liability and your catalog is software subscriptions rather than mixed agency and infrastructure services.`,
  overviewDecabillLead: $localize`:@@featureDecabillComparison-paddle-overviewDecabill:Decabill keeps billing under your control. You operate the platform, choose Stripe or extensible processors, bill hosting alongside SaaS, and issue ZUGFeRD invoices for German and EU compliance. Customer and admin consoles, multi-tenancy, and cloud provisioning live in one stack you can self-host or run on Decabill Cloud.`,
  technologyFitLead: COMPARISON_TECHNOLOGY_FIT_LEAD,
};
