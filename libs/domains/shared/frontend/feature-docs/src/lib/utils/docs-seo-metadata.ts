/**
 * SEO copy for docs pages. Translation units live in the shared docs app i18n catalogs;
 * each brand selects units by docs content root while reusing the same id naming scheme.
 */
export function getDocsMetaDescriptionFallback(contentRoot: string): string {
  if (contentRoot === 'decabill') {
    return $localize`:@@featureDocsPage-metaDescriptionFallbackDecabill:Official Decabill documentation: install, deploy, secure, and operate billing APIs, subscriptions, payment processors, and the billing console for platform teams.`;
  }

  return $localize`:@@featureDocsPage-metaDescriptionFallback:Official Agenstra documentation: install, deploy, secure, and operate agent hosts, workspaces, tickets, APIs, and integrations for platform teams.`;
}

export function getDocsMetaKeywords(contentRoot: string): string {
  if (contentRoot === 'decabill') {
    return $localize`:@@featureDocsPage-metaKeywordsDecabill:Decabill, billing, subscriptions, payment processing, invoicing, Stripe, billing API, billing console, multi-tenant billing`;
  }

  return $localize`:@@featureDocsPage-metaKeywords:Agenstra, AI agents, agent management, distributed systems, AI agent infrastructure, agent platform, AI agent console, container management, WebSocket agents, Docker agents`;
}

export function getDocsSearchMetaDescription(contentRoot: string): string {
  if (contentRoot === 'decabill') {
    return $localize`:@@featureDocsSearchPage-metaDescriptionDecabill:Search Decabill docs for setup guides, API references, security hardening, billing configuration, deployment patterns, and troubleshooting.`;
  }

  return $localize`:@@featureDocsSearchPage-metaDescription:Search Agenstra docs for setup guides, API references, security hardening, agent configuration, deployment patterns, and troubleshooting.`;
}
