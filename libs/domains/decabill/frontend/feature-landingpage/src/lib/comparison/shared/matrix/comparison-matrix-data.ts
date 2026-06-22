import type {
  ComparisonMatrixRowLabel,
  ComparisonMatrixRowViewModel,
  ComparisonSlug,
  MatrixStrength,
} from './comparison-matrix.model';

export const COMPARISON_MATRIX_ROW_LABELS: readonly ComparisonMatrixRowLabel[] = [
  {
    dimension: $localize`:@@featureDecabillComparison-matrixDim1:Unified revenue models (SaaS + services + hosting)`,
    question: $localize`:@@featureDecabillComparison-matrixQ1:Can we bill subscriptions, project or service work, and managed hosting without separate billing stacks?`,
  },
  {
    dimension: $localize`:@@featureDecabillComparison-matrixDim2:Multi-tenant operator model`,
    question: $localize`:@@featureDecabillComparison-matrixQ2:Can we run multiple brands, agencies, or client tenants from one billing deployment with isolation?`,
  },
  {
    dimension: $localize`:@@featureDecabillComparison-matrixDim3:Self-hosted, open source, or private deployment`,
    question: $localize`:@@featureDecabillComparison-matrixQ3:Can we run billing on our own infrastructure or VPC with full data control?`,
  },
  {
    dimension: $localize`:@@featureDecabillComparison-matrixDim4:Customer self-service billing console`,
    question: $localize`:@@featureDecabillComparison-matrixQ4:Can customers subscribe, manage plans, pay invoices, and update billing profiles without tickets to our team?`,
  },
  {
    dimension: $localize`:@@featureDecabillComparison-matrixDim5:Admin revenue operations console`,
    question: $localize`:@@featureDecabillComparison-matrixQ5:Can finance and ops run bill-now, manual invoices, KPIs, and exception handling in one admin UI?`,
  },
  {
    dimension: $localize`:@@featureDecabillComparison-matrixDim6:EU-compliant invoicing (ZUGFeRD / EN 16931)`,
    question: $localize`:@@featureDecabillComparison-matrixQ6:Do we get structured, compliant B2B invoices suitable for German and EU bookkeeping, not PDFs alone?`,
  },
  {
    dimension: $localize`:@@featureDecabillComparison-matrixDim7:Managed hosting tied to billing`,
    question: $localize`:@@featureDecabillComparison-matrixQ7:When we sell hosting, does subscription payment automatically provision and lifecycle-manage servers?`,
  },
  {
    dimension: $localize`:@@featureDecabillComparison-matrixDim8:Service catalog and plan configuration`,
    question: $localize`:@@featureDecabillComparison-matrixQ8:Can we publish priced plans with provider schemas, highlights, and margins without custom code per product line?`,
  },
  {
    dimension: $localize`:@@featureDecabillComparison-matrixDim9:Real-time provisioning and subscription status`,
    question: $localize`:@@featureDecabillComparison-matrixQ9:Do operators and customers see live server and subscription state, not batch emails or manual checks?`,
  },
  {
    dimension: $localize`:@@featureDecabillComparison-matrixDim10:Finance export and bookkeeping handoff (DATEV ecosystem)`,
    question: $localize`:@@featureDecabillComparison-matrixQ10:Can finance close the month without re-keying line items, especially in German agency contexts?`,
  },
  {
    dimension: $localize`:@@featureDecabillComparison-matrixDim11:Payment processor flexibility (Stripe + extensibility)`,
    question: $localize`:@@featureDecabillComparison-matrixQ11:Can we take payments through Stripe today and add or swap processors without rewriting billing core?`,
  },
  {
    dimension: $localize`:@@featureDecabillComparison-matrixDim12:Enterprise SSO / identity integration`,
    question: $localize`:@@featureDecabillComparison-matrixQ12:Does it fit corporate IdP patterns (OIDC/SAML) for console access and automation auth?`,
  },
  {
    dimension: $localize`:@@featureDecabillComparison-matrixDim13:Full billing API and integration surface`,
    question: $localize`:@@featureDecabillComparison-matrixQ13:Can we integrate ordering, subscriptions, invoices, and admin flows via documented APIs, not screen-scraping?`,
  },
];

const DECABILL_SCORES: readonly MatrixStrength[] = Array(13).fill('strong') as MatrixStrength[];

const DECABILL_TOOLTIPS: readonly string[] = [
  $localize`:@@featureDecabillComparison-decabillT1:Single catalog for SaaS subscriptions, agency-style services, and managed hosting in one billing core and console.`,
  $localize`:@@featureDecabillComparison-decabillT2:Multi-tenant deployment with X-Tenant scoping and per-tenant URLs so agencies can run multiple brands and clients from one stack.`,
  $localize`:@@featureDecabillComparison-decabillT3:Open-source core with Docker-based self-hosting and optional Decabill Cloud for managed operation.`,
  $localize`:@@featureDecabillComparison-decabillT4:Dedicated customer console for subscriptions, invoices, payment state, and hosting lifecycle in one view.`,
  $localize`:@@featureDecabillComparison-decabillT5:Admin billing module with KPIs, open and overdue views, bill-now, and manual invoice lifecycle designed for operators and finance.`,
  $localize`:@@featureDecabillComparison-decabillT6:Emits ZUGFeRD-style PDFs with embedded EN 16931 XML so invoices align with German and EU e-invoicing mandates.`,
  $localize`:@@featureDecabillComparison-decabillT7:Built-in Hetzner Cloud and DigitalOcean provisioning via cloud-init, with subscription-driven lifecycle and backorders when capacity is exhausted.`,
  $localize`:@@featureDecabillComparison-decabillT8:Service types and plans with provider schemas and pricing previews, exposed via a public offerings API for marketing sites.`,
  $localize`:@@featureDecabillComparison-decabillT9:WebSocket-powered dashboards stream live provisioning and subscription status into operator and customer views.`,
  $localize`:@@featureDecabillComparison-decabillT10:Structured ZUGFeRD and EN 16931 invoices plus export posture aimed at German DATEV-style workflows and long-term e-archive requirements.`,
  $localize`:@@featureDecabillComparison-decabillT11:Stripe Checkout and webhook integration combined with pluggable payment providers so operators can keep their own PSP relationships.`,
  $localize`:@@featureDecabillComparison-decabillT12:Supports Keycloak with OIDC and SAML plus built-in users and API-key based automation for agency and enterprise setups.`,
  $localize`:@@featureDecabillComparison-decabillT13:OpenAPI-described REST API for customers, subscriptions, invoices, and admin workflows enables deep integration without scraping UIs.`,
];

const COMPETITOR_SCORES: Record<ComparisonSlug, readonly MatrixStrength[]> = {
  whmcs: [
    'weak',
    'weak',
    'partial',
    'partial',
    'partial',
    'weak',
    'partial',
    'partial',
    'partial',
    'partial',
    'partial',
    'weak',
    'weak',
  ],
  hostbill: [
    'partial',
    'weak',
    'partial',
    'partial',
    'partial',
    'weak',
    'partial',
    'partial',
    'partial',
    'partial',
    'partial',
    'partial',
    'partial',
  ],
  'stripe-billing': [
    'weak',
    'weak',
    'weak',
    'partial',
    'partial',
    'weak',
    'weak',
    'partial',
    'partial',
    'partial',
    'weak',
    'partial',
    'partial',
  ],
  chargebee: [
    'partial',
    'partial',
    'weak',
    'partial',
    'partial',
    'weak',
    'weak',
    'partial',
    'partial',
    'partial',
    'partial',
    'partial',
    'partial',
  ],
  paddle: [
    'weak',
    'weak',
    'weak',
    'partial',
    'partial',
    'weak',
    'weak',
    'partial',
    'weak',
    'partial',
    'weak',
    'partial',
    'partial',
  ],
};

const COMPETITOR_TOOLTIPS: Record<ComparisonSlug, readonly string[]> = {
  whmcs: [
    $localize`:@@featureDecabillComparison-whmcsT1:Optimized for classic hosting, domains, and add-ons. SaaS and project or service billing require custom products and workflows rather than a unified model.`,
    $localize`:@@featureDecabillComparison-whmcsT2:Primarily a single-brand hosting panel. Multi-brand setups rely on separate WHMCS instances or heavy customization rather than a native tenant model.`,
    $localize`:@@featureDecabillComparison-whmcsT3:Self-hosted PHP app on your infrastructure, but closed-source and tied closely to traditional shared-hosting stacks with no modern container-native deployment story.`,
    $localize`:@@featureDecabillComparison-whmcsT4:Client area lets customers view services, invoices, and tickets, but is geared to classic hosting rather than mixed SaaS, projects, and managed infrastructure.`,
    $localize`:@@featureDecabillComparison-whmcsT5:Admin UI covers orders, invoices, and automation but focuses on provisioning workflows. Exception handling and finance workflows for agencies are limited and often require plugins.`,
    $localize`:@@featureDecabillComparison-whmcsT6:Can calculate VAT and show VAT IDs on PDF invoices but does not natively generate structured EN 16931 or ZUGFeRD e-invoices. Operators must bolt on separate tooling.`,
    $localize`:@@featureDecabillComparison-whmcsT7:Deep integrations with cPanel and server panels automate shared and VPS hosting, but modern cloud providers and mixed SaaS or hosting catalogs are not first-class.`,
    $localize`:@@featureDecabillComparison-whmcsT8:Product and addon system works for typical hosting bundles but becomes rigid when modeling complex service engagements or multi-line agency offerings.`,
    $localize`:@@featureDecabillComparison-whmcsT9:Relies on cron-based tasks, email notifications, and third-party panel status. There is no unified real-time infra state across heterogeneous providers.`,
    $localize`:@@featureDecabillComparison-whmcsT10:CSV and PDF exports plus VAT handling help finance teams, but there is no native DATEV or EN 16931 e-invoice export. Deeper compliance requires external systems.`,
    $localize`:@@featureDecabillComparison-whmcsT11:Supports multiple gateways such as Stripe, PayPal, and Authorize.net as classic card processors, not as a modular payment-orchestration layer extendable by operators.`,
    $localize`:@@featureDecabillComparison-whmcsT12:Authentication focuses on local accounts. SSO for staff or clients is not a native core capability and usually depends on community modules or reverse proxies.`,
    $localize`:@@featureDecabillComparison-whmcsT13:WHMCS exposes a limited API focused on hosting operations. Many teams rely on custom hooks or unofficial API extensions to cover full billing scenarios.`,
  ],
  hostbill: [
    $localize`:@@featureDecabillComparison-hostbillT1:Strong hosting and domain focus. SaaS or project billing is possible via generic products but lacks the unified services, SaaS, and cloud positioning agencies need.`,
    $localize`:@@featureDecabillComparison-hostbillT2:Built for a single provider brand. Running multiple agencies or white-label tenants typically means separate installations or significant customization.`,
    $localize`:@@featureDecabillComparison-hostbillT3:Licensed, self-hosted PHP application with lifetime-license options but closed source and not container-native by default.`,
    $localize`:@@featureDecabillComparison-hostbillT4:Client portal covers invoices, services, tickets, and downloads, but the UX and data model are tuned to classic hosting scenarios rather than mixed SaaS and agency work.`,
    $localize`:@@featureDecabillComparison-hostbillT5:Rich automation and provisioning UI, yet finance workflows beyond hosting such as projects, retainers, and multi-service accounts require extra configuration and plugins.`,
    $localize`:@@featureDecabillComparison-hostbillT6:Offers VAT calculation and VIES validation plugins but relies on standard PDF invoices. Structured EN 16931 or ZUGFeRD output is not a documented core feature.`,
    $localize`:@@featureDecabillComparison-hostbillT7:Excellent for automating shared hosting, VPS, and email platforms, but public-cloud provider workflows and general-purpose managed hosting catalogs are not central.`,
    $localize`:@@featureDecabillComparison-hostbillT8:Product, addon, and bundle system is powerful for hosting plans but less opinionated for modeling complex agency services or cross-cloud offerings.`,
    $localize`:@@featureDecabillComparison-hostbillT9:Uses automation tasks and provider callbacks. Status is updated but not exposed as a unified real-time stream across all resources.`,
    $localize`:@@featureDecabillComparison-hostbillT10:PDF and CSV exports combined with VAT plugins help EU operators, yet deep DATEV integration and EN 16931 export are not part of the documented offering.`,
    $localize`:@@featureDecabillComparison-hostbillT11:Many gateways and modules exist but are packaged as HostBill-specific integrations. Swapping processors without touching HostBill is harder than with a plugin-centric billing core.`,
    $localize`:@@featureDecabillComparison-hostbillT12:OIDC admin-auth module and related add-ons exist, but enterprise SSO is an optional extension, not a pervasive, first-class identity model across all surfaces.`,
    $localize`:@@featureDecabillComparison-hostbillT13:API coverage exists for core entities, but many billing and admin use cases still rely on HostBill modules or GUI workflows, limiting fully headless integration.`,
  ],
  'stripe-billing': [
    $localize`:@@featureDecabillComparison-stripeT1:Optimized for SaaS subscriptions and usage-based pricing. Service projects and managed hosting require custom modeling and separate tooling.`,
    $localize`:@@featureDecabillComparison-stripeT2:Account model assumes a single business. Multi-brand setups rely on multiple Stripe accounts or custom segregation, not a self-hosted tenant hierarchy.`,
    $localize`:@@featureDecabillComparison-stripeT3:Fully hosted SaaS with no option to run Stripe Billing in your own infrastructure or VPC.`,
    $localize`:@@featureDecabillComparison-stripeT4:Stripe Customer Portal handles subscription updates and payment methods but is a generic hosted surface, not a full customer console spanning hosting and services.`,
    $localize`:@@featureDecabillComparison-stripeT5:Stripe Dashboard provides strong payment analytics and invoice views, yet many finance workflows such as project billing, hosting bundles, and multi-entity ops require external systems or custom code.`,
    $localize`:@@featureDecabillComparison-stripeT6:Can issue PDF invoices and calculate VAT with Stripe Tax, but does not claim ZUGFeRD or EN 16931-compliant structured e-invoicing for Germany.`,
    $localize`:@@featureDecabillComparison-stripeT7:No native concept of servers or hosting lifecycle. Operators must build their own provisioning and status layers on top of billing events.`,
    $localize`:@@featureDecabillComparison-stripeT8:Price objects and products work well for SaaS plans, but complex agency catalogs and infrastructure bundles require significant custom modeling.`,
    $localize`:@@featureDecabillComparison-stripeT9:Webhooks provide event notifications, but real-time infra status is not part of Stripe. Teams must wire their own dashboards and polling.`,
    $localize`:@@featureDecabillComparison-stripeT10:Strong revenue and payout reporting, yet EU finance teams still rely on additional tooling to meet EN 16931 and German DATEV requirements.`,
    $localize`:@@featureDecabillComparison-stripeT11:Tightly coupled to Stripe's own payment processing. Using other PSPs for the same billing stack is not supported.`,
    $localize`:@@featureDecabillComparison-stripeT12:Stripe Dashboard SSO and role management are SaaS features. Customer identity integration for consoles beyond payment pages must be built separately.`,
    $localize`:@@featureDecabillComparison-stripeT13:Excellent APIs for payments and subscriptions, but broader billing-ops surfaces such as manual invoices, hosting lifecycle, and multi-tenant admin live outside Stripe's scope and must be custom-built.`,
  ],
  chargebee: [
    $localize`:@@featureDecabillComparison-chargebeeT1:Subscription-first platform focused on SaaS and recurring revenue. Project work and managed hosting require workarounds or adjacent systems.`,
    $localize`:@@featureDecabillComparison-chargebeeT2:Supports multiple sites and entities in higher tiers, but as a hosted SaaS it is not an operator-controlled, self-hosted tenant model.`,
    $localize`:@@featureDecabillComparison-chargebeeT3:Fully hosted SaaS only with no open-source or self-hosted edition for private infrastructure.`,
    $localize`:@@featureDecabillComparison-chargebeeT4:Offers a customer portal for subscription changes and payments, but not a hosting-aware console tied to infrastructure lifecycle.`,
    $localize`:@@featureDecabillComparison-chargebeeT5:Strong subscription analytics and RevRec capabilities, yet operational workflows around infrastructure and mixed services remain outside its core.`,
    $localize`:@@featureDecabillComparison-chargebeeT6:Can generate invoices and handle taxes, but does not market EN 16931 or ZUGFeRD-compliant German e-invoices as a core feature.`,
    $localize`:@@featureDecabillComparison-chargebeeT7:No native hosting or server provisioning. Infrastructure billing must be built around generic subscription objects.`,
    $localize`:@@featureDecabillComparison-chargebeeT8:Excellent for subscription plans, add-ons, and coupons, but not tailored to infra providers and per-server constructs agencies sell.`,
    $localize`:@@featureDecabillComparison-chargebeeT9:Subscription changes propagate quickly, but there is no concept of real-time server provisioning state in the billing UI.`,
    $localize`:@@featureDecabillComparison-chargebeeT10:Provides revenue reports and accounting exports, yet EN 16931, ZUGFeRD, and DATEV-specific capabilities must be layered through separate tools.`,
    $localize`:@@featureDecabillComparison-chargebeeT11:Integrates with Stripe, Braintree, Adyen, and others, but as a closed SaaS platform where processors are configured in Chargebee rather than through an extensible plugin surface.`,
    $localize`:@@featureDecabillComparison-chargebeeT12:SSO and role management exist in higher tiers, yet as a hosted app this is primarily for Chargebee's UI, not a self-hosted identity fabric for customer consoles.`,
    $localize`:@@featureDecabillComparison-chargebeeT13:Provides solid APIs around subscriptions and invoices, but deep integration with infra provisioning and multi-tenant admin still requires significant custom work.`,
  ],
  paddle: [
    $localize`:@@featureDecabillComparison-paddleT1:Merchant-of-record platform optimized for SaaS and digital products. Project work and managed hosting fall outside its core focus.`,
    $localize`:@@featureDecabillComparison-paddleT2:Paddle acts as MoR for a single vendor. Multi-brand operation requires separate vendor setups, not a tenant hierarchy you control.`,
    $localize`:@@featureDecabillComparison-paddleT3:Fully hosted MoR model with no self-hosting or on-premises edition.`,
    $localize`:@@featureDecabillComparison-paddleT4:Hosted checkout and subscription management surfaces work for SaaS payments, but there is no infra-aware, agency-style customer console.`,
    $localize`:@@featureDecabillComparison-paddleT5:Strong dashboards for SaaS revenue and churn, yet operational views for services and hosting must live in other tools.`,
    $localize`:@@featureDecabillComparison-paddleT6:Handles global VAT and sales tax as MoR but does not expose ZUGFeRD or EN 16931 structured invoices for operators' own records.`,
    $localize`:@@featureDecabillComparison-paddleT7:No concept of servers or managed hosting lifecycle. Paddle's remit stops at SaaS and digital product transactions.`,
    $localize`:@@featureDecabillComparison-paddleT8:Handles SaaS pricing and subscriptions, but infra-heavy and agency catalogs require external systems.`,
    $localize`:@@featureDecabillComparison-paddleT9:Subscription state is available, but infra provisioning is out of scope. Operators must build their own real-time views.`,
    $localize`:@@featureDecabillComparison-paddleT10:As MoR, Paddle shoulders tax compliance and remittance, but finance data is abstracted. DATEV-style exports rely on Paddle's reports plus extra processing.`,
    $localize`:@@featureDecabillComparison-paddleT11:Paddle is an all-in-one MoR. You cannot choose your own underlying PSP or swap processors while keeping Paddle's billing.`,
    $localize`:@@featureDecabillComparison-paddleT12:Identity and access management are tied to Paddle's SaaS dashboards. Deep integration with customer IdPs for a self-hosted console is not the model.`,
    $localize`:@@featureDecabillComparison-paddleT13:APIs focus on subscription and payment flows, with less emphasis on exposing MoR internals or integrating infra and tenant-level operations.`,
  ],
};

export function buildComparisonMatrixRows(slug: ComparisonSlug): ComparisonMatrixRowViewModel[] {
  const competitorScores = COMPETITOR_SCORES[slug];
  const competitorTooltips = COMPETITOR_TOOLTIPS[slug];

  return COMPARISON_MATRIX_ROW_LABELS.map((label, index) => {
    const decabill = DECABILL_SCORES[index];
    const decabillTooltip = DECABILL_TOOLTIPS[index];
    const competitor = competitorScores[index];
    const competitorTooltip = competitorTooltips[index];

    if (
      decabill === undefined ||
      decabillTooltip === undefined ||
      competitor === undefined ||
      competitorTooltip === undefined
    ) {
      throw new Error(`Missing comparison matrix data for ${slug} row ${String(index)}`);
    }

    return {
      ...label,
      decabill,
      decabillTooltip,
      competitor,
      competitorTooltip,
    };
  });
}
