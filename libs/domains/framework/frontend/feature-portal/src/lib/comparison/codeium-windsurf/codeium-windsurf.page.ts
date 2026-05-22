import type { ComparisonPageConfig } from '../shared/misc/comparison-page.model';
import { COMPARISON_TECHNOLOGY_FIT_LEAD } from '../shared/misc/comparison-technology-fit-lead';

export const CODEIUM_WINDSURF_COMPARISON_PAGE: ComparisonPageConfig = {
  slug: 'codeium-windsurf',
  competitorDisplayName: 'Codeium / Windsurf',
  metaTitle: $localize`:@@featurePortalComparison-codeium-metaTitle:Codeium & Windsurf vs Agenstra :: Agenstra`,
  metaDescription: $localize`:@@featurePortalComparison-codeium-metaDescription:Compare Codeium and Windsurf with Agenstra’s multi-workspace agent control plane, browser IDE, ticket workflows, and self-hosted governance for platform teams.`,
  canonicalUrl: 'https://agenstra.com/compare/codeium-windsurf',
  heroSubtitle: $localize`:@@featurePortalComparison-codeium-heroSubtitle:Broad IDE coverage and optional self-hosted backends versus a dedicated agent operations console.`,
  overviewCompetitorLead: $localize`:@@featurePortalComparison-codeium-overviewCompetitor:Codeium reaches developers across many editors, while Windsurf offers a dedicated AI-native editing experience from the same vendor. Organizations choose them for broad rollout, inline help inside existing repos, and deployment options that keep sensitive workloads closer to home.`,
  overviewAgenstraLead: $localize`:@@featurePortalComparison-codeium-overviewAgenstra:Agenstra gives you one console to run and govern coding agents on infrastructure you control. It pairs agent workspaces with tickets, knowledge, and deployment workflows so platform teams can standardize delivery and oversight where data residency and operations matter.`,
  technologyFitLead: COMPARISON_TECHNOLOGY_FIT_LEAD,
};
