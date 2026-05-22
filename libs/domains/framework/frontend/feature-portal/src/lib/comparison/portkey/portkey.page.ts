import type { ComparisonPageConfig } from '../shared/misc/comparison-page.model';
import { COMPARISON_TECHNOLOGY_FIT_LEAD } from '../shared/misc/comparison-technology-fit-lead';

export const PORTKEY_COMPARISON_PAGE: ComparisonPageConfig = {
  slug: 'portkey',
  competitorDisplayName: 'Portkey',
  metaTitle: $localize`:@@featurePortalComparison-portkey-metaTitle:Portkey vs Agenstra :: Agenstra`,
  metaDescription: $localize`:@@featurePortalComparison-portkey-metaDescription:Compare Portkey’s LLM gateway with Agenstra’s workspace-oriented agent control plane for coding agents, tickets, IDE access, and governed software delivery.`,
  canonicalUrl: 'https://agenstra.com/compare/portkey',
  heroSubtitle: $localize`:@@featurePortalComparison-portkey-heroSubtitle:Centralized model traffic governance versus Docker agent hosts with IDE and ticket workflows.`,
  overviewCompetitorLead: $localize`:@@featurePortalComparison-portkey-overviewCompetitor:Portkey gives you a central gateway for model and agent traffic so you can enforce guardrails, trace usage, and switch providers without rewriting every application. Its strength is unified governance of LLM calls rather than a full product surface for coding agents, Git, and delivery boards.`,
  overviewAgenstraLead: $localize`:@@featurePortalComparison-portkey-overviewAgenstra:Agenstra gives you one console to run and govern coding agents on infrastructure you control. It pairs agent workspaces with tickets, knowledge, and deployment workflows so platform teams can standardize delivery and oversight where data residency and operations matter.`,
  technologyFitLead: COMPARISON_TECHNOLOGY_FIT_LEAD,
};
