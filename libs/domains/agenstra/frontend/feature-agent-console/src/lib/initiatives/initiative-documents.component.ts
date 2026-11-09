import { CommonModule } from '@angular/common';
import {
  Component,
  LOCALE_ID,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  InitiativesFacade,
  type InitiativeArtifactDto,
  type InitiativeArtifactVersionDto,
  type InitiativeDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  INITIATIVE_ARTIFACT_TYPES,
  findInitiativeStep,
  type InitiativeArtifactType,
  type InitiativeStepKey,
} from '@forepath/agenstra/shared/util-initiative-method';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcDataTableComponent,
  FpcDatePipe,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcTableCellDirective,
  fpcCopyText,
  fpcFormatDateTime,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import { KnowledgeEditorComponent } from '../knowledge/knowledge-editor/knowledge-editor.component';
import { AG_DL_DELETE, agOpenItem } from '../shared/data-list';

import {
  artifactStatusLabel,
  artifactStatusTone,
  artifactVersionSourceLabel,
  initiativeArtifactTypeLabel,
  initiativeStepLabel,
  initiativeTableTone,
} from './initiative-labels';
import { filterInitiativeRows } from './initiative-table-search';

import { InitiativeMarkdownRenderer } from './initiative-markdown';
import type { InitiativeStartRequest } from './initiative-runs.component';

/** Step that writes each document type (BMad workflow). */
const STEP_OF_TYPE: Partial<Record<InitiativeArtifactType, InitiativeStepKey>> = {
  brainstorm: 'brainstorm',
  'forge-report': 'forge-idea',
  research: 'research',
  'product-brief': 'product-brief',
  prfaq: 'prfaq',
  prd: 'prd',
  ux: 'ux',
  architecture: 'architecture',
  'project-context': 'project-context',
  retrospective: 'retrospective',
};

/**
 * Documents (PRD, UX, architecture, …): edited by people (markdown editor, conditional saves), drafted by step runs,
 * accepted as the shared contract, with every version kept (view and compare). Live: another user's save shows up
 * without overwriting unsaved edits.
 */
@Component({
  selector: 'framework-initiative-documents',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcDatePipe,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcTableCellDirective,
    KnowledgeEditorComponent,
  ],
  providers: [InitiativeMarkdownRenderer],
  templateUrl: './initiative-documents.component.html',
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        min-height: 0;
      }
      .docs-editor {
        min-height: 420px;
      }
      .docs-plain {
        white-space: pre-wrap;
        word-break: break-word;
      }
    `,
  ],
})
export class InitiativeDocumentsComponent {
  readonly initiative = input.required<InitiativeDto>();
  readonly startStep = output<InitiativeStartRequest>();

  private readonly facade = inject(InitiativesFacade);
  private readonly locale = inject(LOCALE_ID);
  readonly markdown = inject(InitiativeMarkdownRenderer);

  readonly tableLabel = $localize`:@@featureInitiatives-docsTableLabel:Documents`;
  readonly searchPlaceholder = $localize`:@@featureInitiatives-docsSearch:Search documents`;
  readonly newDocumentLabel = $localize`:@@featureInitiatives-newDocument:New document`;
  readonly documentLabel = $localize`:@@featureInitiatives-docsDocument:Document`;
  readonly versionsLabel = $localize`:@@featureInitiatives-versions:Versions`;
  readonly versionTitle = $localize`:@@featureInitiatives-docsCurrentVersion:Current version`;
  readonly copyReferenceLabel = $localize`:@@featureInitiatives-copyReference:Copy context reference`;
  readonly hideVersionLabel = $localize`:@@featureInitiatives-docsHideVersion:Hide this version`;
  readonly statusLabel = artifactStatusLabel;
  readonly statusTone = artifactStatusTone;

  readonly columns: FpcTableColumn<InitiativeArtifactDto>[] = [
    {
      id: 'state',
      label: $localize`:@@featureInitiatives-colState:State`,
      type: 'state',
      state: (row) => ({
        label: artifactStatusLabel(row.status),
        tone: initiativeTableTone(artifactStatusTone(row.status)),
      }),
    },
    {
      id: 'title',
      label: $localize`:@@featureInitiatives-docsColTitle:Title`,
      value: (row) => row.title,
      required: true,
      priority: 1,
    },
    {
      id: 'type',
      label: $localize`:@@featureInitiatives-docsColType:Type`,
      value: (row) => initiativeArtifactTypeLabel(row.type),
      priority: 2,
    },
    {
      id: 'epic',
      label: $localize`:@@featureInitiatives-docsColEpic:Epic`,
      value: (row) => (row.workItemId ? this.epicKey(row.workItemId) : ''),
      priority: 3,
    },
    {
      id: 'version',
      label: $localize`:@@featureInitiatives-docsColVersion:Version`,
      value: (row) => row.currentVersion,
      align: 'end',
      priority: 2,
    },
    {
      id: 'updated',
      label: $localize`:@@featureInitiatives-colUpdated:Updated`,
      value: (row) => fpcFormatDateTime(row.updatedAt, this.locale, '—'),
      priority: 3,
    },
  ];

  readonly versionColumns: FpcTableColumn<InitiativeArtifactVersionDto>[] = [
    {
      id: 'state',
      label: $localize`:@@featureInitiatives-colState:State`,
      type: 'state',
      state: (row) =>
        row.accepted
          ? { label: artifactStatusLabel('accepted'), tone: 'success' }
          : { label: $localize`:@@featureInitiatives-docsVersionNotAccepted:Not accepted`, tone: 'neutral' },
    },
    {
      id: 'version',
      label: $localize`:@@featureInitiatives-docsColVersion:Version`,
      value: (row) => row.version,
      required: true,
      priority: 1,
    },
    {
      id: 'iteration',
      label: $localize`:@@featureInitiatives-colIteration:Iteration`,
      value: (row) => row.iteration,
      priority: 2,
    },
    {
      id: 'source',
      label: $localize`:@@featureInitiatives-colSource:Source`,
      value: (row) => artifactVersionSourceLabel(row.source),
      priority: 2,
    },
    {
      id: 'time',
      label: $localize`:@@featureInitiatives-colTime:Time`,
      value: (row) => row.createdAt,
      priority: 1,
    },
  ];

  readonly rowMenu = (row: InitiativeArtifactDto): FpcMenuItem[] => {
    const step = STEP_OF_TYPE[row.type];

    return [
      agOpenItem(),
      ...(step
        ? [
            {
              id: 'update',
              label: $localize`:@@featureInitiatives-updateWithAgent:Update with the agent`,
              icon: 'stars',
              dividerBefore: true,
            },
            ...(this.canValidate(step)
              ? [
                  {
                    id: 'validate',
                    label: $localize`:@@featureInitiatives-validateWithAgent:Validate`,
                    icon: 'clipboard-check',
                  },
                ]
              : []),
          ]
        : []),
      ...(row.status !== 'accepted'
        ? [
            {
              id: 'accept',
              label: $localize`:@@featureInitiatives-acceptDocument:Accept version`,
              icon: 'check2-circle',
              dividerBefore: !step,
            },
          ]
        : []),
      {
        id: 'publish',
        label: $localize`:@@featureInitiatives-publish:Publish to Knowledge`,
        icon: 'journal-arrow-up',
        dividerBefore: !step && row.status === 'accepted',
      },
      { id: 'copy-reference', label: this.copyReferenceLabel, icon: 'link-45deg' },
      { id: 'delete', label: AG_DL_DELETE, icon: 'trash', danger: true, dividerBefore: true },
    ];
  };

  readonly versionRowMenu = (): FpcMenuItem[] => [
    { id: 'view', label: $localize`:@@featureInitiatives-view:View`, icon: 'eye' },
  ];
  private readonly editor = viewChild(KnowledgeEditorComponent);

  readonly artifacts = toSignal(this.facade.artifacts$, { initialValue: [] as InitiativeArtifactDto[] });
  readonly query = signal('');
  readonly visibleArtifacts = computed(() => filterInitiativeRows(this.artifacts(), this.query(), this.columns));
  readonly open = toSignal(this.facade.openArtifact$, { initialValue: null });
  readonly versions = toSignal(this.facade.versions$, { initialValue: [] as InitiativeArtifactVersionDto[] });
  readonly compare = toSignal(this.facade.compareVersion$, { initialValue: null });
  readonly workItems = toSignal(this.facade.workItems$, { initialValue: null });
  readonly pending = toSignal(this.facade.pending$, { initialValue: false });

  readonly types = INITIATIVE_ARTIFACT_TYPES.filter((type) => type !== 'retrospective');
  readonly typeLabel = initiativeArtifactTypeLabel;
  readonly selectedId = signal<string | null>(null);

  readonly draft = signal('');
  readonly draftTitle = signal('');
  /** Document version the draft started from (saves are conditional on it). */
  readonly draftBase = signal<{ id: string; version: number; content: string; title: string } | null>(null);
  /** Content of the last save; its echo (new version) becomes the base of further edits. */
  private lastSubmitted: { id: string; content: string; title: string } | null = null;
  readonly dirty = computed(() => {
    const base = this.draftBase();

    return !!base && (this.draft() !== base.content || this.draftTitle().trim() !== base.title);
  });
  readonly changedMeanwhile = computed(() => {
    const base = this.draftBase();
    const open = this.open();

    return this.dirty() && !!base && !!open && open.id === base.id && open.version !== base.version;
  });

  readonly createOpen = signal(false);
  readonly createType = signal<InitiativeArtifactType>('prd');
  readonly createTitle = signal('');
  /** Document of the delete confirmation (from the row menu, open or not). */
  readonly deleteTarget = signal<InitiativeArtifactDto | null>(null);

  constructor() {
    effect(() => {
      const id = this.selectedId();

      untracked(() => this.facade.openArtifact(id));
    });

    // Editor follows the document until the user edits it (then a banner says it changed meanwhile).
    effect(() => {
      const open = this.open();

      untracked(() => {
        if (!open || open.content === undefined) {
          return;
        }

        const base = this.draftBase();

        if (!base || base.id !== open.id || !this.dirty()) {
          this.draftBase.set({ id: open.id, version: open.version, content: open.content, title: open.title });
          this.draft.set(open.content);
          this.draftTitle.set(open.title);

          return;
        }

        // Our own save came back while the user kept typing: that version is the new base (never someone else's).
        const submitted = this.lastSubmitted;

        if (
          submitted &&
          submitted.id === open.id &&
          submitted.content === open.content &&
          submitted.title === open.title
        ) {
          this.draftBase.set({ id: open.id, version: open.version, content: open.content, title: open.title });
          this.lastSubmitted = null;
        }
      });
    });
  }

  epicKey(workItemId: string | null): string {
    return (this.workItems()?.items ?? []).find((item) => item.id === workItemId)?.key ?? '';
  }

  select(artifact: InitiativeArtifactDto): void {
    if (artifact.id !== this.selectedId()) {
      this.draftBase.set(null);
      this.selectedId.set(artifact.id);
    }
  }

  /** Closing the document drops an unsaved draft (it follows the document again when reopened). */
  close(): void {
    this.draftBase.set(null);
    this.lastSubmitted = null;
    this.selectedId.set(null);
  }

  onRowAction(artifact: InitiativeArtifactDto, action: string): void {
    switch (action) {
      case 'open':
        this.select(artifact);
        break;
      case 'update':
        this.runStep(artifact, 'update');
        break;
      case 'validate':
        this.runStep(artifact, 'validate');
        break;
      case 'accept':
        this.accept(artifact);
        break;
      case 'publish':
        this.publish(artifact);
        break;
      case 'copy-reference':
        this.copyReference(artifact);
        break;
      case 'delete':
        this.deleteTarget.set(artifact);
        break;
    }
  }

  onVersionAction(artifact: InitiativeArtifactDto, version: InitiativeArtifactVersionDto, action: string): void {
    if (action === 'view') {
      this.viewVersion(artifact, version);
    }
  }

  save(): void {
    const base = this.draftBase();
    const current = this.editor()?.getMarkdown();

    if (current !== null && current !== undefined) {
      this.draft.set(current);
    }

    if (!base || !this.dirty()) {
      return;
    }

    const title = this.draftTitle().trim() || base.title;

    this.lastSubmitted = { id: base.id, content: this.draft(), title };
    // Conditional on the version the user started from: a document changed in between is refused (409).
    this.facade.run({
      type: 'updateArtifact',
      artifactId: base.id,
      dto: { expectedVersion: base.version, content: this.draft(), title },
    });
  }

  discard(): void {
    const open = this.open();

    if (open?.content !== undefined) {
      this.draftBase.set({ id: open.id, version: open.version, content: open.content, title: open.title });
      this.draft.set(open.content);
      this.draftTitle.set(open.title);
    }

    this.facade.clearError();
  }

  accept(artifact: InitiativeArtifactDto): void {
    this.facade.run({ type: 'acceptArtifact', artifactId: artifact.id, expectedVersion: artifact.version });
  }

  publish(artifact: InitiativeArtifactDto): void {
    this.facade.run({ type: 'publishArtifact', artifactId: artifact.id });
  }

  remove(artifact: InitiativeArtifactDto): void {
    this.facade.run({ type: 'deleteArtifact', artifactId: artifact.id, initiativeId: artifact.initiativeId });
    this.deleteTarget.set(null);

    if (this.selectedId() === artifact.id) {
      this.close();
    }
  }

  copyReference(artifact: InitiativeArtifactDto): void {
    fpcCopyText(`artifact:${artifact.shas.long}`);
  }

  viewVersion(artifact: InitiativeArtifactDto, version: InitiativeArtifactVersionDto | null): void {
    this.facade.compareVersion(artifact.id, version?.version ?? null);
  }

  runStep(artifact: InitiativeArtifactDto, mode: 'update' | 'validate'): void {
    const step = STEP_OF_TYPE[artifact.type];

    if (step) {
      this.startStep.emit({ step, mode, workItemId: artifact.workItemId ?? undefined });
    }
  }

  stepLabel(step: InitiativeStepKey): string {
    return initiativeStepLabel(step);
  }

  canValidate(step: InitiativeStepKey | undefined): boolean {
    return !!step && !!findInitiativeStep(step)?.modes.includes('validate');
  }

  submitCreate(): void {
    this.facade.run({
      type: 'createArtifact',
      initiativeId: this.initiative().id,
      dto: { type: this.createType(), ...(this.createTitle().trim() ? { title: this.createTitle().trim() } : {}) },
    });
    this.createOpen.set(false);
  }

  openCreate(): void {
    this.createType.set('prd');
    this.createTitle.set('');
    this.createOpen.set(true);
  }
}
