import {
  backendMessageLabel,
  type ActivityItem,
  type HealthState,
} from '@forepath/loadweaver/frontend/data-access-console';

import { formatInstants, healthEntityRef } from '../health/health-format';
import { healthLabel } from './console-format';

/**
 * Recent activity (`GET /overview` → `activity`, the control plane's event timeline) as people read it (D7 / D11,
 * LW-03 / LW-04): the server writes English sentences with raw ids (`plan <uuid> applied`, `site/default: healthy →
 * failed (…)`); the feed shows translated text with names instead, links plans, and keeps unknown events as they are.
 */

const PLAN_EVENT = /^plan [0-9a-f-]{8,} (applied|failed|rolled-back|rolling back)(?::\s*(.*))?$/s;
const HEALTH_EVENT = /^(\S+): (\S+) → (\S+)(?: \(.*\))?$/s;

/** An event kind, readable (unknown kinds as they are). */
export function activityKindLabel(kind: string): string {
  switch (kind) {
    case 'plan':
      return $localize`:@@lwConsoleActivity-kindPlan:Plan`;
    case 'health':
      return $localize`:@@lwConsoleActivity-kindHealth:Health`;
    case 'drift':
      return $localize`:@@lwConsoleActivity-kindDrift:Drift`;
    case 'backup-policy-drift':
      return $localize`:@@lwConsoleActivity-kindBackupPolicy:Backup policy`;
    case 'node-protocol-refused':
      return $localize`:@@lwConsoleActivity-kindNodeProtocol:Node agent`;
    default:
      return kind;
  }
}

function planStatusText(status: string): string {
  switch (status) {
    case 'applied':
      return $localize`:@@lwConsoleActivity-planApplied:Plan applied`;
    case 'failed':
      return $localize`:@@lwConsoleActivity-planFailed:Plan failed`;
    case 'rolled-back':
      return $localize`:@@lwConsoleActivity-planRolledBack:Plan rolled back`;
    default:
      return $localize`:@@lwConsoleActivity-planRollingBack:Plan rolling back`;
  }
}

function stateText(state: string): string {
  return state === 'new' ? $localize`:@@lwConsoleActivity-stateNew:new` : healthLabel(state as HealthState);
}

/** The activity text: "Plan applied", "Site default: Healthy → Failed", else the server message (instants formatted). */
export function activityText(item: Pick<ActivityItem, 'kind' | 'entity' | 'message'>, locale: string): string {
  if (item.kind === 'plan') {
    const match = PLAN_EVENT.exec(item.message);

    if (match) {
      const text = planStatusText(match[1]);

      return match[2] ? `${text}: ${formatInstants(match[2], locale)}` : text;
    }
  }

  if (item.kind === 'health') {
    const match = HEALTH_EVENT.exec(item.message);

    if (match) {
      // The reason stays on the health page; the feed names the entity and the transition.
      return `${healthEntityRef(item.entity || match[1]).label}: ${stateText(match[2])} → ${stateText(match[3])}`;
    }
  }

  return formatInstants(item.message, locale);
}

/** Where an activity row leads: the plan of plan events, the entity's health of health events. */
export function activityLink(item: Pick<ActivityItem, 'kind' | 'entity'>): string | null {
  if (item.kind === 'plan' && /^[0-9a-f-]{36}$/i.test(item.entity))
    return `/activity/plans/${encodeURIComponent(item.entity)}`;

  if (item.kind === 'health' && healthEntityRef(item.entity).kind) return `/observe/health/${item.entity}`;

  return null;
}

const HEALTH_INBOX_TITLE = /^\S+ \S+: (.*)$/s;
const HEALTH_LINK = /\/observe\/health\/([^?#]+)/;

/** The server's request inbox title (old `request(s)` and the pluralized wording). */
const POLICY_REQUESTS_TITLE =
  /^(\d+) policy requests?(?:\(s\))? from (?:other projects|another project) waits? for (.+)$/;

/**
 * A needs-attention item's title for people (LW-19 / D7): health items are `<kind> <name>: <reason>` from the server
 * (`cluster cluster: the control plane lost its quorum (…)`) → "Cluster: The control plane lost its quorum (…)" with
 * the translated kind and reason; other titles start with a capital letter.
 */
export function inboxItemTitle(item: { kind: string; title: string; link: string }): string {
  // "1 policy request(s) from other projects wait for shop" → real plural forms (X-02 round 2).
  if (item.kind === 'cross-project-request') {
    const match = POLICY_REQUESTS_TITLE.exec(item.title);

    if (match) {
      const count = Number(match[1]);
      const project = match[2];

      return count === 1
        ? $localize`:@@lwConsoleOverview-policyRequestsOne:1 policy request from another project waits for ${project}:project:`
        : $localize`:@@lwConsoleOverview-policyRequestsOther:${count}:count: policy requests from other projects wait for ${project}:project:`;
    }
  }

  if (item.kind === 'health') {
    const match = HEALTH_INBOX_TITLE.exec(item.title);
    const key = HEALTH_LINK.exec(item.link)?.[1];

    if (match && key) {
      const ref = healthEntityRef(decodeURIComponent(key));

      if (ref.kind) return `${ref.label}: ${backendMessageLabel(match[1])}`;
    }
  }

  return backendMessageLabel(item.title);
}
