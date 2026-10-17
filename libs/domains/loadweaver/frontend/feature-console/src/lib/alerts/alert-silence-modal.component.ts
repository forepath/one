import { CommonModule } from '@angular/common';
import { Component, DestroyRef, effect, inject, input, model, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ConsoleAlertsFacade,
  createSilenceSuccess,
  type CreateAlertSilence,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
} from '@forepath/shared/frontend/ui-components';
import { Actions, ofType } from '@ngrx/effects';

import { toLocalInput } from './alert-format';

const HOUR_MS = 3_600_000;

/** What a new silence starts with (from an alert: its rule, key and project). */
export interface SilencePrefill {
  rule?: string | null;
  project?: string | null;
  key?: string | null;
}

/** Creates a silence (3.18): rule (or prefix ending in `*`), project, key, reason and the window. */
@Component({
  selector: 'loadweaver-alert-silence-modal',
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
  ],
  templateUrl: './alert-silence-modal.component.html',
  standalone: true,
})
export class LoadweaverAlertSilenceModalComponent {
  private readonly facade = inject(ConsoleAlertsFacade);

  readonly open = model(false);
  readonly prefill = input<SilencePrefill | null>(null);
  /** Projects the caller may pick. */
  readonly projects = input<string[]>([]);

  readonly saving = toSignal(this.facade.silenceSaving$, { initialValue: false });
  readonly error = toSignal(this.facade.actionError$, { initialValue: null });

  rule = '';
  project = '';
  key = '';
  reason = '';
  startsAt = '';
  endsAt = '';
  readonly invalid = signal<string | null>(null);

  readonly title = $localize`:@@lwConsoleSilence-title:New silence`;
  readonly needsMatcher = $localize`:@@lwConsoleSilence-needsMatcher:Set at least one of rule, project or key.`;
  readonly needsReason = $localize`:@@lwConsoleSilence-needsReason:Give a reason.`;
  readonly badWindow = $localize`:@@lwConsoleSilence-badWindow:The silence has to end after it starts.`;

  constructor() {
    effect(() => {
      if (this.open()) this.reset(this.prefill());
    });
    inject(Actions)
      .pipe(ofType(createSilenceSuccess), takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => this.open.set(false));
  }

  submit(): void {
    const rule = this.rule.trim();
    const project = this.project.trim();
    const key = this.key.trim();
    const reason = this.reason.trim();

    if (!rule && !project && !key) return this.invalid.set(this.needsMatcher);

    if (!reason) return this.invalid.set(this.needsReason);

    const starts = this.startsAt ? new Date(this.startsAt) : new Date();
    const ends = new Date(this.endsAt);

    if (Number.isNaN(ends.getTime()) || ends <= starts) return this.invalid.set(this.badWindow);

    this.invalid.set(null);

    const silence: CreateAlertSilence = {
      reason,
      endsAt: ends.toISOString(),
      ...(rule ? { rule } : {}),
      ...(project ? { project } : {}),
      ...(key ? { key } : {}),
      ...(this.startsAt ? { startsAt: starts.toISOString() } : {}),
    };

    this.facade.createSilence(silence);
  }

  private reset(prefill: SilencePrefill | null): void {
    const now = new Date();

    this.rule = prefill?.rule ?? '';
    this.project = prefill?.project ?? '';
    this.key = prefill?.key ?? '';
    this.reason = '';
    this.startsAt = '';
    this.endsAt = toLocalInput(new Date(now.getTime() + 2 * HOUR_MS));
    this.invalid.set(null);
    this.facade.clearActionError();
  }
}
