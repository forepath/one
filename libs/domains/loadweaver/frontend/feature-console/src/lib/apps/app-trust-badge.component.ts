import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { TrustLabel } from '@forepath/loadweaver/frontend/data-access-console';
import { FpcBadgeComponent } from '@forepath/shared/frontend/ui-components';

import { TRUST_HINT, TRUST_ICON, TRUST_TONE, trustText } from './apps-format';

/** An app's trust label (P1): Official · Verified publisher · Community, with what it means as the tooltip. */
@Component({
  selector: 'loadweaver-app-trust-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FpcBadgeComponent],
  template: `
    @if (trust(); as t) {
      <span class="d-inline-flex" [title]="hint()" [attr.data-trust]="t" data-testid="app-trust-badge">
        <fpc-badge size="sm" [tone]="tone()" [icon]="icon()">{{ label() }}</fpc-badge>
      </span>
    }
  `,
})
export class LoadweaverAppTrustBadgeComponent {
  readonly trust = input<TrustLabel | null | undefined>(null);

  readonly label = computed(() => trustText(this.trust()));
  readonly tone = computed(() => TRUST_TONE[this.trust() ?? 'community'] ?? 'neutral');
  readonly icon = computed(() => TRUST_ICON[this.trust() ?? 'community'] ?? null);
  readonly hint = computed(() => {
    const t = this.trust();

    return t ? (TRUST_HINT[t] ?? '') : '';
  });
}
