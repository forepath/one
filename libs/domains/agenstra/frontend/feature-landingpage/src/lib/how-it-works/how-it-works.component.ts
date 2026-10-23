import { CommonModule, DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  Injector,
  LOCALE_ID,
  OnInit,
  signal,
} from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { ENVIRONMENT, type EnvironmentWithLandingAndCommunication } from '@forepath/shared/frontend/util-configuration';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/shared/frontend/util-meta';
import { FpcBadgeComponent, FpcButtonComponent } from '@forepath/shared/frontend/ui-components';

import { ArchitectureIllustrationComponent } from '../illustrations/architecture-illustration.component';
import { SharedContactPersonComponent } from '@forepath/shared/frontend/feature-landingpage';

/** Isolation levels compared in the limits section, weakest first (the order of the tabs). */
const ISOLATION_LEVELS = ['standard', 'sandboxed', 'sandboxed-kvm', 'microvm'] as const;

type IsolationLevel = (typeof ISOLATION_LEVELS)[number];

const LIMITS_FRAGMENT_PREFIX = 'limits-';

function isIsolationLevel(value: string): value is IsolationLevel {
  return (ISOLATION_LEVELS as readonly string[]).includes(value);
}

@Component({
  selector: 'framework-portal-how-it-works',
  imports: [
    SharedContactPersonComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    CommonModule,
    RouterModule,
    ArchitectureIllustrationComponent,
  ],
  styleUrls: ['./how-it-works.component.scss'],
  templateUrl: './how-it-works.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalHowItWorksComponent implements OnInit {
  /** Example web traffic policy for one environment layer (the format of the agent configuration). */
  protected readonly egressPolicyExample = `{
  "egress": {
    "mode": "enforce",
    "block_private_networks": true,
    "allow_hosts": [
      "github.com",
      "npmjs.org"
    ],
    "deny_hosts": ["paste.example"],
    "network_allow": [{
      "protocol": "tcp",
      "ports": "22",
      "destinations": ["10.20.0.0/16"]
    }]
  }
}`;

  /**
   * Level shown in the limits comparison. Sandboxed is the default because it runs on every prepared host,
   * including ordinary cloud VMs, so it is the level most readers will actually get.
   */
  protected readonly activeIsolationLevel = signal<IsolationLevel>('sandboxed');

  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<EnvironmentWithLandingAndCommunication>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  constructor() {
    // A direct visit to `#limits-<level>` opens that level's tab (browser only; SSR renders the default tab).
    afterNextRender(() => {
      const fragment = this.document.defaultView?.location.hash.slice(1) ?? '';
      const level = fragment.startsWith(LIMITS_FRAGMENT_PREFIX) ? fragment.slice(LIMITS_FRAGMENT_PREFIX.length) : '';

      if (isIsolationLevel(level)) {
        this.showIsolationLimits(level, false);
      }
    });
  }

  ngOnInit(): void {
    const metaTitle = $localize`:@@featurePortalHowItWorks-metaTitle:How Agenstra works: architecture, sandboxing and egress control :: Agenstra`;
    const metaDescription = $localize`:@@featurePortalHowItWorks-metaDescription:A technical look at Agenstra: control plane, agent managers, gVisor-sandboxed agent containers, per-environment egress guards, layered policy and audit trails.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@featurePortalHowItWorks-metaKeywords:Agenstra architecture, AI agent sandbox, gVisor coding agents, gVisor KVM sandbox, KVM microVM for AI agents, agent container isolation, egress filtering for AI agents, agent control plane, self-hosted coding agents`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://agenstra.com/how-it-works',
          socialTitle: metaTitle,
          socialDescription: metaDescription,
          socialImageUrl: this.environment.socialPreview.urls.image,
          localeId: this.locale,
          localizeCanonicalUrl: this.environment.application.production,
        }),
      ),
    );
  }

  protected selectIsolationLevel(level: IsolationLevel): void {
    this.activeIsolationLevel.set(level);
  }

  /**
   * "Limits and mitigations" links under each stack: the href (`#limits-<level>`) works without JavaScript;
   * with it, the matching tab opens, the tab bar scrolls into view and receives focus.
   */
  protected openIsolationLimits(event: MouseEvent, level: IsolationLevel): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    this.showIsolationLimits(level, true);
  }

  /** Arrow keys, Home and End move between the level tabs (automatic activation, roving focus). */
  protected onIsolationTabKeydown(event: KeyboardEvent): void {
    const current = ISOLATION_LEVELS.indexOf(this.activeIsolationLevel());
    const last = ISOLATION_LEVELS.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? (current + 1) % ISOLATION_LEVELS.length
        : event.key === 'ArrowLeft'
          ? (current + last) % ISOLATION_LEVELS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;

    if (next === null) {
      return;
    }

    event.preventDefault();
    this.activeIsolationLevel.set(ISOLATION_LEVELS[next]);
    (event.currentTarget as HTMLElement)
      .closest('[role="tablist"]')
      ?.querySelector<HTMLElement>(`#limits-tab-${ISOLATION_LEVELS[next]}`)
      ?.focus();
  }

  private showIsolationLimits(level: IsolationLevel, updateUrl: boolean): void {
    this.activeIsolationLevel.set(level);

    afterNextRender(
      () => {
        const view = this.document.defaultView;
        const tabs = this.document.getElementById('limits-levels');

        if (!view || !tabs) {
          return;
        }

        if (updateUrl) {
          view.history.replaceState(
            view.history.state,
            '',
            `${view.location.pathname}${view.location.search}#${LIMITS_FRAGMENT_PREFIX}${level}`,
          );
        }

        const reducedMotion = view.matchMedia('(prefers-reduced-motion: reduce)').matches;

        tabs.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
        this.document.getElementById(`limits-tab-${level}`)?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }
}
