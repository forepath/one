import type { ComparisonPageConfig } from '../shared/misc/comparison-page.model';
import { COMPARISON_TECHNOLOGY_FIT_LEAD } from '../shared/misc/comparison-technology-fit-lead';

export const CHARGEBEE_COMPARISON_PAGE: ComparisonPageConfig = {
  slug: 'chargebee',
  competitorDisplayName: 'Chargebee',
  metaTitle: $localize`:@@featureDecabillComparison-chargebee-metaTitle:Chargebee vs Decabill`,
  metaDescription: $localize`:@@featureDecabillComparison-chargebee-metaDescription:Compare Chargebee subscription billing with Decabill for self-hosted revenue operations, hosting provisioning, EU e-invoicing, and multi-tenant agency billing.`,
  canonicalUrl: 'https://decabill.com/compare/chargebee',
  heroSubtitle: $localize`:@@featureDecabillComparison-chargebee-heroSubtitle:Hosted subscription platform versus self-hosted revenue operations for agencies and product teams.`,
  overviewCompetitorLead: $localize`:@@featureDecabillComparison-chargebee-overviewCompetitor:Chargebee is a mature subscription management platform for SaaS companies. It handles plans, coupons, dunning, revenue recognition, and integrations with major payment gateways from a hosted console. It fits when recurring SaaS is your primary model and you want a vendor to run billing logic while you focus on product delivery.`,
  overviewDecabillLead: $localize`:@@featureDecabillComparison-chargebee-overviewDecabill:Decabill targets teams that outgrow subscription-only tooling. It combines SaaS billing with agency services and managed hosting, ships ZUGFeRD invoices, provisions Hetzner and DigitalOcean servers from subscriptions, and can run on your infrastructure with tenant isolation and Keycloak-backed SSO.`,
  technologyFitLead: COMPARISON_TECHNOLOGY_FIT_LEAD,
};
