import type { ComparisonPageConfig } from '../shared/misc/comparison-page.model';
import { COMPARISON_TECHNOLOGY_FIT_LEAD } from '../shared/misc/comparison-technology-fit-lead';

export const ORQ_AI_COMPARISON_PAGE: ComparisonPageConfig = {
  slug: 'orq-ai',
  competitorDisplayName: 'Orq.ai',
  metaTitle: $localize`:@@featurePortalComparison-orq-metaTitle:Orq.ai vs Agenstra :: Agenstra`,
  metaDescription: $localize`:@@featurePortalComparison-orq-metaDescription:Compare Orq.ai’s agent lifecycle platform with Agenstra’s coding agent control plane: workspaces, delivery workflows, auditability, and infrastructure you control.`,
  canonicalUrl: 'https://agenstra.com/compare/orq-ai',
  heroSubtitle: $localize`:@@featurePortalComparison-orq-heroSubtitle:Managed experimentation and deployments versus ops-owned Docker agent infrastructure.`,
  overviewCompetitorLead: $localize`:@@featurePortalComparison-orq-overviewCompetitor:Orq.ai helps teams prototype, deploy, and monitor generative AI agents and experiments across projects with roles and workspaces built for collaboration. It appeals when you want a hosted lifecycle platform for many AI use cases and compliance-aware deployment options from the vendor.`,
  overviewAgenstraLead: $localize`:@@featurePortalComparison-orq-overviewAgenstra:Agenstra gives you one console to run and govern coding agents on infrastructure you control. It pairs agent workspaces with tickets, knowledge, and deployment workflows so platform teams can standardize delivery and oversight where data residency and operations matter.`,
  technologyFitLead: COMPARISON_TECHNOLOGY_FIT_LEAD,
};
