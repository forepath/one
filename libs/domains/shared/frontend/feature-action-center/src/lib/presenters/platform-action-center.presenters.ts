import type { ActionCenterLink, ActionCenterPresenterSet } from './action-center-presenter.types';
import { paramText } from './action-center-presenter.types';

/** Where the shared platform items lead in the consuming console. */
export interface PlatformActionCenterLinks {
  updates: ActionCenterLink;
  webhooks: ActionCenterLink;
  /** Settings page holding the SMTP configuration (admin-only). */
  emailSettings: ActionCenterLink;
}

/**
 * Presenters of the `platform.*` items every product reports (updates, webhooks, email delivery) plus the category
 * headings shared by both consoles.
 */
export function platformActionCenterPresenters(links: PlatformActionCenterLinks): ActionCenterPresenterSet {
  return {
    categories: {
      setup: $localize`:@@featureActionCenter-categorySetup:Suggested next steps`,
      platform: $localize`:@@featureActionCenter-categoryPlatform:Platform`,
    },
    types: {
      'platform.updates.available': {
        icon: 'cloud-arrow-down',
        title: $localize`:@@featureActionCenter-updatesTitle:Update available`,
        description: (group) =>
          paramText(group.params, 'latestVersion')
            ? $localize`:@@featureActionCenter-updatesDescription:Version ${paramText(group.params, 'latestVersion')}:version: is available (installed: ${paramText(group.params, 'installedVersion')}:installed:).`
            : $localize`:@@featureActionCenter-updatesDescriptionInstances:Some instances run an outdated version.`,
        link: () => links.updates,
        actionLabel: $localize`:@@featureActionCenter-updatesAction:Review update`,
      },
      'platform.webhooks.failing': {
        icon: 'broadcast',
        title: $localize`:@@featureActionCenter-webhooksTitle:Webhooks failing`,
        description: $localize`:@@featureActionCenter-webhooksDescription:Deliveries fail repeatedly; endpoints are disabled after too many failures.`,
        link: () => links.webhooks,
        itemTitle: (item) => paramText(item.params, 'name'),
        itemMeta: (item) =>
          item.params['disabled'] === true
            ? $localize`:@@featureActionCenter-webhooksDisabled:Disabled after repeated failures`
            : $localize`:@@featureActionCenter-webhooksFailures:${paramText(item.params, 'failures')}:count: failed deliveries in a row`,
      },
      'platform.email.delivery_failed': {
        icon: 'envelope-exclamation',
        title: $localize`:@@featureActionCenter-emailFailedTitle:Emails not delivered`,
        description: $localize`:@@featureActionCenter-emailFailedDescription:Emails of the last 7 days could not be sent; check the mail server settings.`,
        link: () => links.emailSettings,
        itemTitle: (item) => paramText(item.params, 'eventType') || paramText(item.params, 'template'),
        itemMeta: (item, format) => format.relative(item.occurredAt),
      },
      'platform.setup.email': {
        icon: 'envelope-at',
        title: $localize`:@@featureActionCenter-emailSetupTitle:Set up email delivery`,
        description: $localize`:@@featureActionCenter-emailSetupDescription:No mail server is configured, so no emails (invoices, sign-in codes, notifications) are sent.`,
        link: () => links.emailSettings,
        actionLabel: $localize`:@@featureActionCenter-setUp:Set up`,
      },
    },
  };
}
