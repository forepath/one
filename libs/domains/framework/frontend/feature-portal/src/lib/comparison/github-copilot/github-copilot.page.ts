import type { ComparisonPageConfig } from '../shared/misc/comparison-page.model';
import { COMPARISON_TECHNOLOGY_FIT_LEAD } from '../shared/misc/comparison-technology-fit-lead';

export const GITHUB_COPILOT_COMPARISON_PAGE: ComparisonPageConfig = {
  slug: 'github-copilot',
  competitorDisplayName: 'GitHub Copilot',
  metaTitle: $localize`:@@featurePortalComparison-copilot-metaTitle:GitHub Copilot vs Agenstra :: Agenstra`,
  metaDescription: $localize`:@@featurePortalComparison-copilot-metaDescription:Compare GitHub Copilot and Copilot coding agent with Agenstra’s agent control plane, browser IDE, workspaces, tickets, and operations-focused governance.`,
  canonicalUrl: 'https://agenstra.com/compare/github-copilot',
  heroSubtitle: $localize`:@@featurePortalComparison-copilot-heroSubtitle:GitHub-native AI assistance versus an infrastructure-first agent operations stack.`,
  overviewCompetitorLead: $localize`:@@featurePortalComparison-copilot-overviewCompetitor:GitHub Copilot brings AI assistance into GitHub and popular editors, with enterprise-grade access controls aligned to repos and organizations you already manage there. It fits teams that want GitHub to stay the hub for review, identity, and automation while AI stays close to pull requests and CI.`,
  overviewAgenstraLead: $localize`:@@featurePortalComparison-copilot-overviewAgenstra:Agenstra gives you one console to run and govern coding agents on infrastructure you control. It pairs agent workspaces with tickets, knowledge, and deployment workflows so platform teams can standardize delivery and oversight where data residency and operations matter.`,
  technologyFitLead: COMPARISON_TECHNOLOGY_FIT_LEAD,
};
