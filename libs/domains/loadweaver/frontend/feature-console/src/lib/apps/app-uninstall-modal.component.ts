import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  apiErrorMessage,
  APP_DATA_POLICIES,
  type AppDataPolicy,
  AppStoreService,
  type InstalledApp,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
} from '@forepath/shared/frontend/ui-components';

import { appPlanRoute, DATA_POLICY_TEXT, uninstallReady } from './apps-format';

/**
 * Uninstall an app (P1): what happens to its data is asked every time — keep the volumes, a final backup (run when
 * the plan is applied, before the app is removed; volumes kept), or delete them (the plan lists the volume deletions; deleting needs the deployment's name typed in, applying
 * a confirmation; backups are kept) — never silently. `POST …/uninstall-plan`; the plan opens next.
 */
@Component({
  selector: 'loadweaver-app-uninstall-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
  ],
  template: `
    <fpc-modal [open]="open()" (openChange)="open.set($event)" [title]="title()" accent="danger">
      @if (app(); as a) {
        <p class="small">
          <span class="font-monospace">{{ a.project }}/{{ a.deployment }}</span>
          <span class="text-body-secondary"> · {{ a.app.version }}</span>
        </p>
        <p class="fw-semibold small mb-2">{{ questionLabel }}</p>
        <div role="radiogroup" [attr.aria-label]="questionLabel" data-testid="app-uninstall-policies">
          @for (p of policies; track p) {
            <fpc-form-check
              type="radio"
              name="lw-app-uninstall-policy"
              [checkId]="'lw-app-uninstall-' + p"
              [value]="p"
              [label]="text[p].label"
              [hint]="text[p].hint"
              [checked]="policy() === p"
              (checkedChange)="$event && policy.set(p)"
              [attr.data-testid]="'app-uninstall-policy-' + p"
            />
          }
        </div>
        @if (policy() === 'delete') {
          <fpc-alert variant="danger" class="mt-2" [message]="deleteNote" data-testid="app-uninstall-delete-note" />
          <fpc-form-field class="mt-2" forId="lw-app-uninstall-confirm" [label]="confirmLabel(a.deployment)">
            <fpc-form-control
              controlId="lw-app-uninstall-confirm"
              size="sm"
              controlClass="font-monospace"
              autocomplete="off"
              [ngModel]="typed()"
              (ngModelChange)="typed.set($event)"
              data-testid="app-uninstall-confirm"
            />
          </fpc-form-field>
        }
        @if (error(); as message) {
          <fpc-alert variant="danger" [message]="message" data-testid="app-uninstall-error" />
        }
      }
      <div *fpcModalFooter class="d-flex justify-content-end gap-2">
        <fpc-button variant="secondary" (clicked)="open.set(false)">
          <span>{{ cancelLabel }}</span>
        </fpc-button>
        <fpc-button
          variant="danger"
          [disabled]="!ready() || saving()"
          [loading]="saving()"
          (clicked)="submit()"
          data-testid="app-uninstall-submit"
        >
          <i class="bi bi-file-diff me-1" aria-hidden="true"></i><span>{{ planLabel }}</span>
        </fpc-button>
      </div>
    </fpc-modal>
  `,
})
export class LoadweaverAppUninstallModalComponent {
  private readonly api = inject(AppStoreService);
  private readonly router = inject(Router);

  readonly open = model(false);
  readonly app = input<InstalledApp | null>(null);

  /** No default: the data policy is always an explicit choice. */
  readonly policy = signal<AppDataPolicy | null>(null);
  readonly typed = signal('');
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly policies = APP_DATA_POLICIES;
  readonly text = DATA_POLICY_TEXT;
  readonly ready = computed(() => uninstallReady(this.policy(), this.typed(), this.app()?.deployment ?? ''));
  readonly title = computed(() => {
    const a = this.app();

    return a
      ? $localize`:@@lwConsoleApps-uninstallTitle:Uninstall ${a.title ?? a.app.name}:app:`
      : $localize`:@@lwConsoleApps-uninstall:Uninstall`;
  });
  readonly questionLabel = $localize`:@@lwConsoleApps-dataQuestion:What should happen to the app's data?`;
  readonly planLabel = $localize`:@@lwConsoleApps-createUninstallPlan:Create uninstall plan`;
  readonly cancelLabel = $localize`:@@lwConsoleApps-cancel:Cancel`;
  readonly failedLabel = $localize`:@@lwConsoleApps-uninstallFailed:The uninstall plan couldn't be created.`;
  readonly deleteNote = $localize`:@@lwConsoleApps-deleteNote:The volumes are deleted when the plan is applied, not before; the plan shows each deletion. Backups of the volumes are not deleted: they follow their normal retention.`;

  readonly confirmLabel = (deployment: string): string =>
    $localize`:@@lwConsoleApps-confirmDelete:Type ${deployment}:deployment: to confirm deleting the data`;

  constructor() {
    effect(() => {
      if (this.open()) {
        this.app();
        this.policy.set(null);
        this.typed.set('');
        this.error.set(null);
        this.saving.set(false);
      }
    });
  }

  submit(): void {
    const app = this.app();
    const policy = this.policy();

    if (!app || !policy || !this.ready() || this.saving()) return;

    this.saving.set(true);
    this.error.set(null);
    const request = policy === 'delete' ? { dataPolicy: policy, confirm: this.typed().trim() } : { dataPolicy: policy };

    this.api.uninstallPlan(app.project, app.deployment, request).subscribe({
      next: (result) => {
        this.saving.set(false);
        this.open.set(false);
        void this.router.navigate(appPlanRoute(result) ?? ['/activity/plans']);
      },
      error: (e: unknown) => {
        this.saving.set(false);
        this.error.set(apiErrorMessage(e, this.failedLabel));
      },
    });
  }
}
