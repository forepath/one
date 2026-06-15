import type { ComparisonPageConfig } from '../shared/misc/comparison-page.model';
import { COMPARISON_TECHNOLOGY_FIT_LEAD } from '../shared/misc/comparison-technology-fit-lead';

export const TABNINE_ENTERPRISE_COMPARISON_PAGE: ComparisonPageConfig = {
  slug: 'tabnine-enterprise',
  competitorDisplayName: 'Tabnine Enterprise',
  metaTitle: $localize`:@@featurePortalComparison-tabnine-metaTitle:Tabnine vs Agenstra :: Agenstra`,
  metaDescription: $localize`:@@featurePortalComparison-tabnine-metaDescription:Compare self-hosted Tabnine Enterprise with Agenstra’s agent control plane, browser IDE, workspace operations, tickets, and governance for coding agents.`,
  canonicalUrl: 'https://agenstra.com/compare/tabnine-enterprise',
  heroSubtitle: $localize`:@@featurePortalComparison-tabnine-heroSubtitle:Private assistant clusters versus containerized agent fleets with tickets and deployments.`,
  overviewCompetitorLead: $localize`:@@featurePortalComparison-tabnine-overviewCompetitor:Tabnine Enterprise keeps AI coding assistance inside your VPC or data center so completions and chat stay on infrastructure you operate. It suits teams whose priority is private assistant coverage in familiar editors rather than a full agent operations layer for remote workspaces.`,
  overviewAgenstraLead: $localize`:@@featurePortalComparison-tabnine-overviewAgenstra:Agenstra gives you one console to run and govern coding agents on infrastructure you control. It pairs agent workspaces with tickets, knowledge, and deployment workflows so platform teams can standardize delivery and oversight where data residency and operations matter.`,
  technologyFitLead: COMPARISON_TECHNOLOGY_FIT_LEAD,
};
