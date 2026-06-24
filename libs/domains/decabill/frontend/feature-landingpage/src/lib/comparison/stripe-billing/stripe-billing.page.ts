import type { ComparisonPageConfig } from '../shared/misc/comparison-page.model';
import { COMPARISON_TECHNOLOGY_FIT_LEAD } from '../shared/misc/comparison-technology-fit-lead';

export const STRIPE_BILLING_COMPARISON_PAGE: ComparisonPageConfig = {
  slug: 'stripe-billing',
  competitorDisplayName: 'Stripe Billing',
  metaTitle: $localize`:@@featureDecabillComparison-stripe-metaTitle:Stripe Billing vs Decabill`,
  metaDescription: $localize`:@@featureDecabillComparison-stripe-metaDescription:Compare Stripe Billing with Decabill for operators who need self-hosted multi-tenant billing, hosting lifecycle, ZUGFeRD invoices, and admin revenue operations beyond payments.`,
  canonicalUrl: 'https://decabill.com/compare/stripe-billing',
  heroSubtitle: $localize`:@@featureDecabillComparison-stripe-heroSubtitle:Payments-first SaaS billing versus an operator platform for subscriptions, services, and hosted infrastructure.`,
  overviewCompetitorLead: $localize`:@@featureDecabillComparison-stripe-overviewCompetitor:Stripe Billing is the subscription and invoicing layer inside Stripe's payments platform. It excels at recurring SaaS pricing, usage meters, tax calculation, and a hosted customer portal tied to Stripe Checkout. It fits when payments are your center of gravity and you are comfortable building everything else around Stripe's APIs and hosted surfaces.`,
  overviewDecabillLead: $localize`:@@featureDecabillComparison-stripe-overviewDecabill:Decabill is a billing platform you operate, not a payments processor you rent. It connects subscriptions, invoices, customer self-service, and cloud provisioning in one stack with ZUGFeRD output, Keycloak SSO, and multi-tenant isolation. You keep Stripe for payments while owning the catalog, consoles, and hosting lifecycle.`,
  technologyFitLead: COMPARISON_TECHNOLOGY_FIT_LEAD,
};
