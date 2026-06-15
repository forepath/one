import type { ComparisonPageConfig } from '../shared/misc/comparison-page.model';
import { COMPARISON_TECHNOLOGY_FIT_LEAD } from '../shared/misc/comparison-technology-fit-lead';

export const DEVIN_COMPARISON_PAGE: ComparisonPageConfig = {
  slug: 'devin',
  competitorDisplayName: 'Devin',
  metaTitle: $localize`:@@featurePortalComparison-devin-metaTitle:Devin vs Agenstra :: Agenstra`,
  metaDescription: $localize`:@@featurePortalComparison-devin-metaDescription:Compare Devin’s cloud autonomous engineer with Agenstra’s self-hosted control plane: workspaces, tickets, team knowledge, releases, and governance on your infrastructure.`,
  canonicalUrl: 'https://agenstra.com/compare/devin',
  heroSubtitle: $localize`:@@featurePortalComparison-devin-heroSubtitle:Cloud sessions from Cognition versus a control plane you run for many Docker-backed coding agents.`,
  overviewCompetitorLead: $localize`:@@featurePortalComparison-devin-overviewCompetitor:Devin gives you a cloud-hosted autonomous engineer that works in a browser with Git and connects to the tools your teams already use for issues and delivery. It fits when you want the vendor to run the workspace and you value a managed experience over operating your own agent infrastructure.`,
  overviewAgenstraLead: $localize`:@@featurePortalComparison-devin-overviewAgenstra:Agenstra gives you one console to run and govern coding agents on infrastructure you control. It pairs agent workspaces with tickets, knowledge, and deployment workflows so platform teams can standardize delivery and oversight where data residency and operations matter.`,
  technologyFitLead: COMPARISON_TECHNOLOGY_FIT_LEAD,
};
