export const FOREPATH_BILLING_UNIT_TIERS = [48, 160, 520, 800, 1600] as const;

/** @deprecated Use FOREPATH_BILLING_UNIT_TIERS */
export const FOREPATH_SOFTWARE_DEVELOPMENT_BILLING_TIERS = FOREPATH_BILLING_UNIT_TIERS;

export const FOREPATH_ON_SITE_TRAVEL_PATTERN =
  /\b(on-site|onsite|on site|at our (office|premises|location)|field work|install(?:ation)? at|travel to|visit (?:our|the|client|customer)|customer site|client site)\b/i;

export const FOREPATH_BUILD_INTENT_TERMS = [
  'build',
  'develop',
  'create',
  'implement',
  'custom',
  'greenfield',
  'from scratch',
] as const;

/** Signals for custom software delivery (not generic IT operations). */
export const FOREPATH_SOFTWARE_BUILD_TERMS = [
  'software',
  'application',
  'app',
  'portal',
  'website',
  'web app',
  'webapp',
  'dashboard',
  'product',
  'backend',
  'frontend',
  'mobile',
  'ios',
  'android',
  'mvp',
  'prototype',
  'codebase',
  'feature',
  'module',
  'interface',
] as const;

/** Strategy, discovery, and advisory work from the consulting offering. */
export const FOREPATH_CONSULTING_TERMS = [
  'consulting',
  'consultant',
  'advisory',
  'adviser',
  'advisor',
  'workshop',
  'discovery',
  'assessment',
  'review',
  'roadmap',
  'strategy',
  'architecture',
  'governance',
  'finops',
  'threat model',
  'threat modeling',
  'audit readiness',
  'coaching',
  'pairing',
  'mentoring',
  'transformation',
  'modernization',
  'due diligence',
] as const;

export const FOREPATH_CONSULTING_MODULE_TERMS = [
  'infrastructure',
  'platform',
  'cloud',
  'devops',
  'delivery',
  'kubernetes',
  'terraform',
  'ai',
  'machine learning',
  'agent',
  'security',
  'iso 27001',
  'iso27001',
  'soc 2',
  'soc2',
] as const;

/** Managed IT and operational support from the IT systems offering. */
export const FOREPATH_IT_SYSTEMS_TERMS = [
  'managed it',
  'managed service',
  'operations',
  'operational',
  'helpdesk',
  'service desk',
  'support desk',
  'monitoring',
  'patching',
  'backup',
  'restore',
  'firewall',
  'network',
  'server',
  'workstation',
  'laptop',
  'desktop',
  'provisioning',
  'm365',
  'office 365',
  'microsoft 365',
  'teams',
  'telephony',
  'virtualization',
  'vmware',
  'hyper-v',
  'proxmox',
  'endpoint',
  'edr',
  'antivirus',
  'incident',
  'on-call',
  'on call',
  'sla',
  'runbook',
  'hosting support',
  'infrastructure support',
  'access control',
  'archiving',
] as const;

export const FOREPATH_IT_CATEGORY_TERMS = [
  'network',
  'server',
  'workstation',
  'laptop',
  'desktop',
  'access control',
  'telephony',
  'backup',
  'archiving',
  'security',
  'endpoint',
  'digital workplace',
  'm365',
  'office 365',
  'microsoft 365',
  'virtualization',
] as const;

export const FOREPATH_ONGOING_OPS_TERMS = [
  'managed',
  'ongoing',
  'monthly',
  'retainer',
  'continuous',
  'recurring',
  '24/7',
  '247',
  'service level',
] as const;

export const FOREPATH_EMERGENCY_TERMS = [
  'emergency',
  'urgent',
  'critical outage',
  'out of hours',
  'after hours',
  'weekend',
  'sunday',
  'saturday',
  'night',
] as const;

export const FOREPATH_CONSULTING_SHORT_ENGAGEMENT_TERMS = [
  'quick',
  'short',
  'brief',
  'single session',
  'one session',
  'introductory',
] as const;

/** Explicit scope qualifiers that push estimates toward larger tiers. */
export const FOREPATH_COMPLEXITY_QUALIFIER_TERMS = [
  'complex',
  'comprehensive',
  'enterprise',
  'large-scale',
  'large scale',
  'mission-critical',
  'mission critical',
  'full-featured',
  'full featured',
  'sophisticated',
  'advanced',
  'multi-tenant',
  'multitenant',
] as const;

/** Technical or functional depth that usually increases delivery effort. */
export const FOREPATH_TECHNICAL_COMPLEXITY_TERMS = [
  'realtime',
  'real-time',
  'live',
  'geospatial',
  'gis',
  'map',
  'location',
  'search',
  'workflow',
  'coordination',
  'matching',
  'notification',
  'payment',
  'billing',
  'reporting',
  'analytics',
  'integration',
  'third-party',
  'third party',
  'sync',
  'offline',
  'permission',
  'role-based',
  'role based',
  'audit',
  'approval',
] as const;

/** Distinct audiences or permission boundaries in the product. */
export const FOREPATH_USER_ROLE_TERMS = [
  'admin',
  'administrator',
  'staff',
  'operator',
  'manager',
  'employee',
  'customer',
  'client',
  'vendor',
  'partner',
  'public',
  'internal',
  'external',
  'moderator',
  'support',
] as const;

export const FOREPATH_WEB_PLATFORM_TERMS = ['web', 'webapp', 'web app', 'portal', 'browser', 'website'] as const;

export const FOREPATH_MOBILE_PLATFORM_TERMS = ['mobile', 'ios', 'android', 'native app'] as const;

export const FOREPATH_MVP_SCOPE_TERMS = [
  'mvp',
  'prototype',
  'proof of concept',
  'proof-of-concept',
  'poc',
  'initial version',
  'first version',
  'minimum viable',
] as const;

export const FOREPATH_SMALL_SCOPE_TERMS = [
  'tiny',
  'small change',
  'minor',
  'fix',
  'bug',
  'patch',
  'hotfix',
  'script',
  'single endpoint',
  'one endpoint',
  'quick',
] as const;

export const FOREPATH_MEDIUM_SCOPE_TERMS = [
  'internal tool',
  'feature',
  'module',
  'endpoint',
  'api',
  'integration',
  'enhancement',
  'extension',
  'refactor',
  'migration',
] as const;

export const FOREPATH_COMPLIANCE_TERMS = [
  'german law',
  'gdpr',
  'dsgvo',
  'compliance',
  'legal',
  'regulatory',
  'datenschutz',
  'recht',
  'privacy',
  'accessibility',
  'wcag',
] as const;

export type ForepathBillableServiceId = 'software-development' | 'consulting' | 'it-systems';

export interface ForepathServiceIntentScores {
  softwareDevelopment: number;
  consulting: number;
  itSystems: number;
}

function normalizePromptForMatching(normalizedPrompt: string): string {
  return normalizedPrompt.toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsTerm(normalizedPrompt: string, term: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegExp(term.toLowerCase())}\\b`, 'i');

  return pattern.test(normalizedPrompt);
}

export function countMatchingTerms(normalizedPrompt: string, terms: readonly string[]): number {
  return terms.reduce((count, term) => (containsTerm(normalizedPrompt, term) ? count + 1 : count), 0);
}

export function containsAnyTerm(normalizedPrompt: string, terms: readonly string[]): boolean {
  return countMatchingTerms(normalizedPrompt, terms) > 0;
}

export function countPlatformSignals(normalizedPrompt: string): number {
  const hasWeb = containsAnyTerm(normalizedPrompt, FOREPATH_WEB_PLATFORM_TERMS);
  const hasMobile = containsAnyTerm(normalizedPrompt, FOREPATH_MOBILE_PLATFORM_TERMS);

  return (hasWeb ? 1 : 0) + (hasMobile ? 1 : 0);
}

export function countComplexitySignals(normalizedPrompt: string): number {
  const prompt = normalizePromptForMatching(normalizedPrompt);

  return (
    countMatchingTerms(prompt, FOREPATH_COMPLEXITY_QUALIFIER_TERMS) * 2 +
    countMatchingTerms(prompt, FOREPATH_TECHNICAL_COMPLEXITY_TERMS) +
    Math.max(0, countMatchingTerms(prompt, FOREPATH_USER_ROLE_TERMS) - 1)
  );
}

export function scoreServiceIntent(normalizedPrompt: string): ForepathServiceIntentScores {
  const prompt = normalizePromptForMatching(normalizedPrompt);
  const buildIntent = containsAnyTerm(prompt, FOREPATH_BUILD_INTENT_TERMS) ? 2 : 0;
  const mediumScopeIntent = containsAnyTerm(prompt, FOREPATH_MEDIUM_SCOPE_TERMS) ? 2 : 0;
  const smallSoftwareIntent =
    containsAnyTerm(prompt, FOREPATH_SMALL_SCOPE_TERMS) &&
    containsAnyTerm(prompt, ['script', 'endpoint', 'api', 'tool', 'fix'])
      ? 2
      : 0;

  const softwareDevelopment =
    buildIntent +
    mediumScopeIntent +
    smallSoftwareIntent +
    countMatchingTerms(prompt, FOREPATH_SOFTWARE_BUILD_TERMS) +
    countMatchingTerms(prompt, FOREPATH_WEB_PLATFORM_TERMS) +
    countMatchingTerms(prompt, FOREPATH_MOBILE_PLATFORM_TERMS);

  const consulting =
    countMatchingTerms(prompt, FOREPATH_CONSULTING_TERMS) +
    countMatchingTerms(prompt, FOREPATH_CONSULTING_MODULE_TERMS);

  const itSystems =
    countMatchingTerms(prompt, FOREPATH_IT_SYSTEMS_TERMS) +
    (containsAnyTerm(prompt, FOREPATH_ONGOING_OPS_TERMS) ? 2 : 0);

  return { softwareDevelopment, consulting, itSystems };
}

export function inferCalibratedServiceIds(normalizedPrompt: string): ForepathBillableServiceId[] {
  const scores = scoreServiceIntent(normalizedPrompt);
  const maxScore = Math.max(scores.softwareDevelopment, scores.consulting, scores.itSystems);

  if (maxScore === 0) {
    return [];
  }

  const intentThreshold = Math.max(1, maxScore * 0.5);
  const serviceIds: ForepathBillableServiceId[] = [];

  if (scores.softwareDevelopment >= intentThreshold) {
    serviceIds.push('software-development');
  }

  if (scores.consulting >= intentThreshold) {
    serviceIds.push('consulting');
  }

  if (scores.itSystems >= intentThreshold) {
    serviceIds.push('it-systems');
  }

  return serviceIds;
}

export function isSoftwareProjectPrompt(normalizedPrompt: string): boolean {
  return inferCalibratedServiceIds(normalizedPrompt).includes('software-development');
}

export function isConsultingPrompt(normalizedPrompt: string): boolean {
  return inferCalibratedServiceIds(normalizedPrompt).includes('consulting');
}

export function isItSystemsPrompt(normalizedPrompt: string): boolean {
  return inferCalibratedServiceIds(normalizedPrompt).includes('it-systems');
}

export function inferSoftwareDevelopmentBillingFloor(normalizedPrompt: string): number | null {
  if (!isSoftwareProjectPrompt(normalizedPrompt)) {
    return null;
  }

  const prompt = normalizePromptForMatching(normalizedPrompt);
  const platformCount = countPlatformSignals(prompt);
  const complexitySignals = countComplexitySignals(prompt);
  const roleSignals = countMatchingTerms(prompt, FOREPATH_USER_ROLE_TERMS);
  const hasSmallScope = containsAnyTerm(prompt, FOREPATH_SMALL_SCOPE_TERMS);
  const hasMediumScope = containsAnyTerm(prompt, FOREPATH_MEDIUM_SCOPE_TERMS);
  const hasMvpScope = containsAnyTerm(prompt, FOREPATH_MVP_SCOPE_TERMS);
  const hasComplexQualifier = containsAnyTerm(prompt, FOREPATH_COMPLEXITY_QUALIFIER_TERMS);

  if (hasSmallScope && !hasComplexQualifier && platformCount === 0 && roleSignals <= 1) {
    return 48;
  }

  if (hasMediumScope && !hasMvpScope && platformCount <= 1 && complexitySignals < 3 && roleSignals <= 1) {
    return 160;
  }

  if (
    complexitySignals >= 4 ||
    (hasComplexQualifier && (platformCount >= 2 || roleSignals >= 2)) ||
    (platformCount >= 2 && roleSignals >= 2) ||
    (platformCount >= 2 && countMatchingTerms(prompt, FOREPATH_TECHNICAL_COMPLEXITY_TERMS) >= 2)
  ) {
    return 1600;
  }

  if (
    hasMvpScope ||
    containsAnyTerm(prompt, FOREPATH_WEB_PLATFORM_TERMS) ||
    containsAnyTerm(prompt, FOREPATH_MOBILE_PLATFORM_TERMS) ||
    roleSignals >= 2
  ) {
    return 520;
  }

  if (hasMediumScope) {
    return 160;
  }

  if (hasSmallScope) {
    return 48;
  }

  return null;
}

export function inferConsultingBillingFloor(normalizedPrompt: string): number | null {
  if (!isConsultingPrompt(normalizedPrompt)) {
    return null;
  }

  const prompt = normalizePromptForMatching(normalizedPrompt);
  const moduleCount = countMatchingTerms(prompt, FOREPATH_CONSULTING_MODULE_TERMS);
  const hasCompliance = containsAnyTerm(prompt, FOREPATH_COMPLIANCE_TERMS);
  const hasComplexQualifier = containsAnyTerm(prompt, FOREPATH_COMPLEXITY_QUALIFIER_TERMS);
  const hasShortEngagement = containsAnyTerm(prompt, FOREPATH_CONSULTING_SHORT_ENGAGEMENT_TERMS);

  if (hasShortEngagement) {
    return 48;
  }

  if (moduleCount >= 2 || hasComplexQualifier || (hasCompliance && moduleCount >= 1)) {
    return 1600;
  }

  if (
    hasCompliance ||
    containsAnyTerm(prompt, ['roadmap', 'discovery', 'architecture review', 'assessment', 'audit readiness'])
  ) {
    return 520;
  }

  if (containsAnyTerm(prompt, ['workshop', 'review', 'strategy session', 'planning session'])) {
    return 160;
  }

  return 520;
}

export function inferItSystemsBillingFloor(normalizedPrompt: string): number | null {
  if (!isItSystemsPrompt(normalizedPrompt)) {
    return null;
  }

  const prompt = normalizePromptForMatching(normalizedPrompt);
  const categoryCount = countMatchingTerms(prompt, FOREPATH_IT_CATEGORY_TERMS);
  const hasOngoing = containsAnyTerm(prompt, FOREPATH_ONGOING_OPS_TERMS);
  const hasSmallScope = containsAnyTerm(prompt, FOREPATH_SMALL_SCOPE_TERMS);

  if (hasSmallScope && categoryCount <= 1 && !hasOngoing) {
    return 48;
  }

  if (categoryCount >= 3 || (hasOngoing && categoryCount >= 3)) {
    return 1600;
  }

  if (hasOngoing || categoryCount >= 2) {
    return 520;
  }

  if (categoryCount === 1) {
    return 160;
  }

  return 160;
}

export function inferMinimumSoftwareDevelopmentTotal(normalizedPrompt: string): number | null {
  if (!isSoftwareProjectPrompt(normalizedPrompt)) {
    return null;
  }

  return inferSoftwareDevelopmentBillingFloor(normalizedPrompt) ?? 520;
}

export function inferMinimumConsultingTotal(normalizedPrompt: string): number | null {
  if (!isConsultingPrompt(normalizedPrompt)) {
    return null;
  }

  return inferConsultingBillingFloor(normalizedPrompt) ?? 520;
}

export function inferMinimumItSystemsTotal(normalizedPrompt: string): number | null {
  if (!isItSystemsPrompt(normalizedPrompt)) {
    return null;
  }

  return inferItSystemsBillingFloor(normalizedPrompt) ?? 160;
}

export function inferItSystemsRateTier(normalizedPrompt: string): 'standard' | 'emergency-week' | 'emergency-sunday' {
  const prompt = normalizePromptForMatching(normalizedPrompt);

  if (/\bsunday\b/.test(prompt)) {
    return 'emergency-sunday';
  }

  if (containsAnyTerm(prompt, FOREPATH_EMERGENCY_TERMS)) {
    return 'emergency-week';
  }

  return 'standard';
}

export function inferDefaultSoftwareDevelopmentDescription(normalizedPrompt: string): string {
  const prompt = normalizePromptForMatching(normalizedPrompt);
  const platformCount = countPlatformSignals(prompt);
  const floor = inferSoftwareDevelopmentBillingFloor(prompt);

  if (floor === 1600 && platformCount >= 2) {
    return 'Multi-platform application delivery';
  }

  if (floor === 1600) {
    return 'Complex custom software application';
  }

  if (floor === 520 || containsAnyTerm(prompt, FOREPATH_MVP_SCOPE_TERMS)) {
    return 'Web application MVP';
  }

  if (floor === 160) {
    return 'Focused software feature or integration';
  }

  return 'Custom software development';
}

export function inferDefaultConsultingDescription(normalizedPrompt: string): string {
  const prompt = normalizePromptForMatching(normalizedPrompt);
  const floor = inferConsultingBillingFloor(prompt);
  const moduleCount = countMatchingTerms(prompt, FOREPATH_CONSULTING_MODULE_TERMS);

  if (floor === 1600) {
    return 'Multi-domain consulting engagement with discovery and roadmap delivery';
  }

  if (containsAnyTerm(prompt, FOREPATH_COMPLIANCE_TERMS)) {
    return 'Compliance and architecture consulting';
  }

  if (moduleCount === 1) {
    return 'Focused consulting engagement';
  }

  if (floor === 160) {
    return 'Workshop and advisory session';
  }

  return 'Discovery, architecture, and delivery consulting';
}

export function inferDefaultItSystemsDescription(normalizedPrompt: string): string {
  const prompt = normalizePromptForMatching(normalizedPrompt);
  const floor = inferItSystemsBillingFloor(prompt);
  const categoryCount = countMatchingTerms(prompt, FOREPATH_IT_CATEGORY_TERMS);

  if (floor === 1600) {
    return 'Multi-area managed IT operations';
  }

  if (containsAnyTerm(prompt, FOREPATH_ONGOING_OPS_TERMS)) {
    return 'Managed IT operations and support';
  }

  if (categoryCount === 1) {
    return 'Focused IT systems support';
  }

  return 'IT systems operational support';
}

export function snapBillingUnits(units: number): number {
  const rounded = Math.max(4, Math.round(units / 4) * 4);

  if ((FOREPATH_BILLING_UNIT_TIERS as readonly number[]).includes(rounded)) {
    return rounded;
  }

  let nearestTier: number = FOREPATH_BILLING_UNIT_TIERS[0];

  for (const tier of FOREPATH_BILLING_UNIT_TIERS) {
    if (Math.abs(tier - rounded) < Math.abs(nearestTier - rounded)) {
      nearestTier = tier;
    }
  }

  if (rounded < nearestTier && rounded >= nearestTier * 0.6) {
    return nearestTier;
  }

  if (rounded > FOREPATH_BILLING_UNIT_TIERS[FOREPATH_BILLING_UNIT_TIERS.length - 1]) {
    return Math.max(rounded, Math.round(rounded / 400) * 400);
  }

  return rounded;
}

/** @deprecated Use snapBillingUnits */
export function snapSoftwareDevelopmentBillingUnits(units: number): number {
  return snapBillingUnits(units);
}

export function inferMinimumBillingTotal(
  serviceId: ForepathBillableServiceId,
  normalizedPrompt: string,
): number | null {
  switch (serviceId) {
    case 'software-development':
      return inferMinimumSoftwareDevelopmentTotal(normalizedPrompt);
    case 'consulting':
      return inferMinimumConsultingTotal(normalizedPrompt);
    case 'it-systems':
      return inferMinimumItSystemsTotal(normalizedPrompt);
  }
}

export function inferBillingFloor(serviceId: ForepathBillableServiceId, normalizedPrompt: string): number | null {
  switch (serviceId) {
    case 'software-development':
      return inferSoftwareDevelopmentBillingFloor(normalizedPrompt);
    case 'consulting':
      return inferConsultingBillingFloor(normalizedPrompt);
    case 'it-systems':
      return inferItSystemsBillingFloor(normalizedPrompt);
  }
}

export function inferDefaultServiceDescription(serviceId: ForepathBillableServiceId, normalizedPrompt: string): string {
  switch (serviceId) {
    case 'software-development':
      return inferDefaultSoftwareDevelopmentDescription(normalizedPrompt);
    case 'consulting':
      return inferDefaultConsultingDescription(normalizedPrompt);
    case 'it-systems':
      return inferDefaultItSystemsDescription(normalizedPrompt);
  }
}
