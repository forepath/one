import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  ConsoleWallboardsFacade,
  type HealthState,
  type InboxItem,
  type KioskSection,
} from '@forepath/loadweaver/frontend/data-access-console';
import { FpcSpinnerComponent } from '@forepath/shared/frontend/ui-components';
import { fromEvent, interval } from 'rxjs';

import { formatShare, HEALTH_ICON, healthLabel } from '../overview/console-format';
import { ThemeService } from '../theme.service';
import { tokenFromHash } from './wallboard-format';

export const KIOSK_REFRESH_MS = 30_000;
/** With several sections (the scope, then each project), each is shown this long. */
export const KIOSK_ROTATE_MS = 15_000;
/** Inbox items shown per section (the rest is counted). */
export const KIOSK_INBOX_LIMIT = 8;

const SEVERITY_ICON: Record<InboxItem['severity'], string> = {
  critical: 'bi-x-octagon-fill',
  warning: 'bi-exclamation-triangle-fill',
  info: 'bi-info-circle-fill',
};

/**
 * The wallboard kiosk (3.25), for a screen in the office: no login, the wallboard token from the URL fragment
 * (`/kiosk#<token>`), sent as `Authorization: Wallboard <token>` only. Full screen with the health headline, what
 * needs attention and the summary, per section in rotation; refreshed every 30 seconds.
 */
@Component({
  selector: 'loadweaver-kiosk-page',
  imports: [CommonModule, FpcSpinnerComponent],
  templateUrl: './kiosk-page.component.html',
  styleUrls: ['./kiosk-page.component.scss'],
  standalone: true,
})
export class LoadweaverKioskPageComponent implements OnInit {
  private readonly facade = inject(ConsoleWallboardsFacade);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly theme = inject(ThemeService);

  readonly view = toSignal(this.facade.kiosk$, { initialValue: null });
  readonly loading = toSignal(this.facade.kioskLoading$, { initialValue: false });
  readonly error = toSignal(this.facade.kioskError$, { initialValue: null });
  readonly unauthorized = toSignal(this.facade.kioskUnauthorized$, { initialValue: false });
  readonly updatedAt = toSignal(this.facade.kioskUpdatedAt$, { initialValue: null });

  readonly token = signal<string | null>(null);
  readonly index = signal(0);
  readonly sections = computed<KioskSection[]>(() => this.view()?.sections ?? []);
  readonly section = computed(() => {
    const sections = this.sections();

    return sections.length > 0 ? sections[this.index() % sections.length] : null;
  });

  readonly healthIcon = HEALTH_ICON;
  readonly healthLabel = healthLabel;
  readonly formatShare = formatShare;
  readonly severityIcon = SEVERITY_ICON;
  readonly inboxLimit = KIOSK_INBOX_LIMIT;

  readonly toggleThemeLabel = $localize`:@@lwConsoleKiosk-toggleTheme:Toggle dark mode`;

  constructor() {
    // Keep the index in range when the number of sections changes.
    effect(() => {
      const count = this.sections().length;

      if (count > 0 && this.index() >= count) this.index.set(0);
    });
  }

  ngOnInit(): void {
    this.readToken();

    const view = this.document.defaultView;

    if (view)
      fromEvent(view, 'hashchange')
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.readToken());

    interval(KIOSK_REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const token = this.token();

        // An invalid token stays invalid: no point asking again.
        if (token && !this.unauthorized()) this.facade.loadKiosk(token, true);
      });
    interval(KIOSK_ROTATE_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.next());
  }

  next(): void {
    const count = this.sections().length;

    if (count > 1) this.index.update((i) => (i + 1) % count);
  }

  tone(state: HealthState): string {
    switch (state) {
      case 'healthy':
        return 'success';
      case 'failed':
        return 'danger';
      case 'unknown':
        return 'secondary';
      default:
        return 'warning';
    }
  }

  private readToken(): void {
    const token = tokenFromHash(this.document.defaultView?.location.hash ?? '');

    this.token.set(token);
    this.index.set(0);

    if (token) this.facade.loadKiosk(token);
  }
}
