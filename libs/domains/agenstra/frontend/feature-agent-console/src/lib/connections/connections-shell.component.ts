import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { FpcTabComponent, FpcTabGroupComponent } from '@forepath/shared/frontend/ui-components';
import { filter } from 'rxjs';

/** Connection kinds of the admin connections area; each is a child route of `/connections`. */
export type ConnectionsSection = 'deployments' | 'atlassian';

interface ConnectionsSectionLink {
  id: ConnectionsSection;
  icon: string;
  label: string;
}

export const CONNECTIONS_SECTIONS: readonly ConnectionsSectionLink[] = [
  {
    id: 'deployments',
    icon: 'rocket-takeoff',
    label: $localize`:@@featureConnectionsNav-deployments:CI/CD`,
  },
  {
    id: 'atlassian',
    icon: 'cloud-download',
    label: $localize`:@@featureConnectionsNav-atlassian:Atlassian`,
  },
];

/** Below Bootstrap `md` (same breakpoint as the console's phone layouts). */
export const CONNECTIONS_PHONE_MEDIA_QUERY = '(max-width: 767.98px)';

/** Section of a `/connections/...` URL; falls back to the first section. */
export function connectionsSectionFromUrl(url: string): ConnectionsSection {
  const segment = (url.split(/[?#]/)[0] ?? '').split('/').filter(Boolean)[1];

  return CONNECTIONS_SECTIONS.find((section) => section.id === segment)?.id ?? CONNECTIONS_SECTIONS[0].id;
}

/**
 * Admin connections area (`/connections`): a left rail (vertical tab group, like `/agent-config`) switches between the
 * connection kinds; the selected kind's page (child route, with its own page header and actions) fills the panel.
 */
@Component({
  selector: 'framework-connections-shell',
  standalone: true,
  imports: [RouterOutlet, FpcTabGroupComponent, FpcTabComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="connections-shell border-top d-flex flex-column">
      <fpc-tab-group
        class="connections-shell__nav"
        [orientation]="phone() ? 'horizontal' : 'vertical'"
        [ariaLabel]="ariaLabel"
        [activeId]="activeSection()"
        (activeIdChange)="onSelectSection($event)"
        data-testid="connections-nav"
      >
        @for (section of sections; track section.id) {
          <fpc-tab
            [id]="section.id"
            [label]="section.label"
            [icon]="section.icon"
            [section]="phone() ? null : sectionTitle"
          />
        }
        <router-outlet />
      </fpc-tab-group>
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        width: 100%;
        min-height: 0;
        overflow: hidden;
      }

      .connections-shell {
        flex: 1 1 0;
        min-height: 0;
        overflow: hidden;
      }

      .connections-shell__nav {
        flex: 1 1 0;
        min-height: 0;
      }

      // The connection pages scroll their own tables; the panel only hosts them.
      .connections-shell__nav ::ng-deep .fpc-tab-group__panels {
        overflow: hidden;
      }
    `,
  ],
})
export class ConnectionsShellComponent {
  private readonly router = inject(Router);

  readonly sections = CONNECTIONS_SECTIONS;
  readonly sectionTitle = $localize`:@@featureConnectionsNav-pageTitle:Connections`;
  readonly ariaLabel = $localize`:@@featureConnectionsNav-ariaLabel:Connection types`;
  readonly activeSection = signal<ConnectionsSection>(connectionsSectionFromUrl(this.router.url));
  /** Phones: the rail would take 40% of the width, so the kinds switch through a horizontal tab bar instead. */
  readonly phone = signal(false);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.watchPhoneLayout();
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => this.activeSection.set(connectionsSectionFromUrl(event.urlAfterRedirects)));
  }

  onSelectSection(id: string | null): void {
    const section = CONNECTIONS_SECTIONS.find((candidate) => candidate.id === id);

    if (!section || section.id === connectionsSectionFromUrl(this.router.url)) {
      return;
    }

    this.activeSection.set(section.id);
    void this.router.navigate(['/connections', section.id]);
  }

  private watchPhoneLayout(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const media = window.matchMedia(CONNECTIONS_PHONE_MEDIA_QUERY);
    const listener = (event: MediaQueryListEvent): void => this.phone.set(event.matches);

    this.phone.set(media.matches);
    media.addEventListener?.('change', listener);
    this.destroyRef.onDestroy(() => media.removeEventListener?.('change', listener));
  }
}
