import type { ComparisonPageConfig } from '../shared/misc/comparison-page.model';
import { COMPARISON_TECHNOLOGY_FIT_LEAD } from '../shared/misc/comparison-technology-fit-lead';

export const CURSOR_COMPARISON_PAGE: ComparisonPageConfig = {
  slug: 'cursor',
  competitorDisplayName: 'Cursor',
  metaTitle: $localize`:@@featurePortalComparison-cursor-metaTitle:Cursor vs Agenstra :: Agenstra`,
  metaDescription: $localize`:@@featurePortalComparison-cursor-metaDescription:Compare Cursor’s AI-native editor with Agenstra’s web console, multi-workspace agent hosts, tickets, governance, and self-hosted delivery options.`,
  canonicalUrl: 'https://agenstra.com/compare/cursor',
  heroSubtitle: $localize`:@@featurePortalComparison-cursor-heroSubtitle:IDE-first velocity versus an operations-focused console for distributed agent hosts.`,
  overviewCompetitorLead: $localize`:@@featurePortalComparison-cursor-overviewCompetitor:Cursor is an AI-first coding environment built around autocomplete, chat, and agent modes in the editor developers already use every day. It focuses on speed and depth inside the desktop workflow rather than running a separate fleet of agent hosts under your own control plane.`,
  overviewAgenstraLead: $localize`:@@featurePortalComparison-cursor-overviewAgenstra:Agenstra gives you one console to run and govern coding agents on infrastructure you control. It pairs agent workspaces with tickets, knowledge, and deployment workflows so platform teams can standardize delivery and oversight where data residency and operations matter.`,
  technologyFitLead: COMPARISON_TECHNOLOGY_FIT_LEAD,
};
