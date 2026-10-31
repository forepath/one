import { CommonModule } from '@angular/common';
import { Component, DestroyRef, effect, inject, input, model, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ConsoleStatusPagesFacade,
  createIncidentSuccess,
  INCIDENT_STATUSES,
  updateIncidentSuccess,
  type Incident,
  type IncidentStatus,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
} from '@forepath/shared/frontend/ui-components';
import { Actions, ofType } from '@ngrx/effects';

import { incidentStatusLabel } from './status-page-format';

const MAX_TITLE = 255;
const MAX_MESSAGE = 4000;

/** Opens an incident of a project, or appends a status and note to one (3.25). */
@Component({
  selector: 'loadweaver-incident-modal',
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
  ],
  templateUrl: './incident-modal.component.html',
  standalone: true,
})
export class LoadweaverIncidentModalComponent {
  private readonly facade = inject(ConsoleStatusPagesFacade);

  readonly open = model(false);
  readonly project = input<string | null>(null);
  /** The incident to update; null opens a new one. */
  readonly incident = input<Incident | null>(null);

  readonly creating = toSignal(this.facade.creating$, { initialValue: false });
  readonly updating = toSignal(this.facade.updating$, { initialValue: null });
  readonly error = toSignal(this.facade.actionError$, { initialValue: null });

  title = '';
  status: IncidentStatus = 'investigating';
  message = '';
  readonly invalid = signal<string | null>(null);

  readonly statuses = INCIDENT_STATUSES;
  readonly statusLabel = incidentStatusLabel;
  readonly maxTitle = MAX_TITLE;
  readonly maxMessage = MAX_MESSAGE;

  readonly createTitle = $localize`:@@lwConsoleIncident-createTitle:New incident`;
  readonly updateTitle = $localize`:@@lwConsoleIncident-updateTitle:Post an update`;
  readonly needsTitle = $localize`:@@lwConsoleIncident-needsTitle:Give the incident a title.`;
  readonly needsMessage = $localize`:@@lwConsoleIncident-needsMessage:Write a note for the status page.`;

  constructor() {
    effect(() => {
      if (this.open()) this.reset(this.incident());
    });
    inject(Actions)
      .pipe(ofType(createIncidentSuccess, updateIncidentSuccess), takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => this.open.set(false));
  }

  saving(): boolean {
    const incident = this.incident();

    return incident ? this.updating() === incident.id : this.creating();
  }

  submit(): void {
    const project = this.project();
    const incident = this.incident();
    const title = this.title.trim();
    const message = this.message.trim();

    if (!project) return;

    if (!incident && !title) return this.invalid.set(this.needsTitle);

    if (!message) return this.invalid.set(this.needsMessage);

    this.invalid.set(null);

    if (incident) this.facade.updateIncident(project, incident.id, { status: this.status, message });
    else this.facade.createIncident(project, { title, status: this.status, message });
  }

  private reset(incident: Incident | null): void {
    this.title = '';
    // An update usually moves the incident on: suggest the next status.
    this.status = incident
      ? (INCIDENT_STATUSES[Math.min(INCIDENT_STATUSES.indexOf(incident.status) + 1, INCIDENT_STATUSES.length - 1)] ??
        'resolved')
      : 'investigating';
    this.message = '';
    this.invalid.set(null);
    this.facade.clearActionError();
  }
}
