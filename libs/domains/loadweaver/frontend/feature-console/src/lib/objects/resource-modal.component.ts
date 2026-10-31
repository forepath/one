import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  authoritativeConnectionsOf,
  checkComposeDocument,
  checkResourceDocument,
  composeOf,
  ConsoleAccessFacade,
  ConsoleEndpointService,
  ConsoleGitFacade,
  ConsoleResourcesFacade,
  type CreatePlanRequest,
  type GitConnection,
  type JsonSchema,
  type ResourceKey,
  type ResourceKindInfo,
  ResourcesService,
  resourceTemplate,
  resourceToYaml,
  sameResourceKey,
  withCompose,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  type FpcCodeDiagnostic,
  FpcCodeEditorComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  type FpcKeyValueItem,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcModalSwap,
  type FpcStep,
  FpcTableCellDirective,
  type FpcTableColumn,
  fpcYamlValidator,
  FpcStepStripComponent,
  FpcStepStripDirective,
} from '@forepath/shared/frontend/ui-components';
import { firstValueFrom } from 'rxjs';
import { parseDocument } from 'yaml';

import { gitScopeLabel } from '../git/git-format';
import { CREATE_KINDS } from '../nav/create-kinds';
import { DraftTrayService } from '../nav/draft-tray.component';
import { kindIcon as resourceKindIcon, resourceLabel } from '../resources/resource-format';
import { LoadweaverVmRecommendedImagesComponent } from '../virtual-machines/vm-recommended-images.component';
import { mayDraftResource, type WorkspaceAccess } from '../workspace/workspace-actions';
import { documentRef, draftOpOf } from '../workspace/workspace-draft';
import { WorkspaceDraftStore } from '../workspace/workspace-draft.store';
import {
  documentMetadata,
  KIND_STEP,
  kindScope,
  type KindScope,
  stepOfIssue,
  validResourceName,
  withDocumentMetadata,
  withSpecField,
  wizardSteps,
} from './create-wizard';
import { resourceObjectRoute } from './object-route';
import { type ResourceModalRequest, ResourceModalService, isCreatableKind } from './resource-modal.service';
import { SCHEMA_FORM_HOST, type SchemaFieldIssue } from './schema-field.component';
import {
  fillRequired,
  formSpec,
  readableIssue,
  specKeys,
  specSchema,
  summarize,
  type SummaryRow,
  withFormSpec,
} from './schema-form';
import { LoadweaverSchemaFormComponent } from './schema-form.component';
import { SCHEMA_KIND_LABELS, SCHEMA_TEXT } from './schema-form-labels';
import { specLineDiff, type SpecLineDiff } from './spec-diff';

/** A problem of the edited documents: the resource YAML or a Deployment's compose file. */
export type ResourceModalProblem = FpcCodeDiagnostic & { source: 'resource' | 'compose' };

/** A schema / syntax issue of the resource document with the step it belongs to. */
export interface ResourceModalIssue {
  path: readonly (string | number)[];
  /** The checker's message (raw; the form translates it at the field). */
  raw: string;
  /** Where and what, in the form's words ("Disk 1 › Size: Required"). */
  message: string;
  step: string;
}

/** One section of the Review summary: a wizard step and its readable rows. */
export interface ResourceModalReviewSection {
  id: string;
  label: string;
  rows: SummaryRow[];
}

/**
 * An empty required text fails "must not be empty" and its pattern ("must match …") at once: only "Required" is useful
 * there, so the format complaint of the same field is dropped (2026-10-29).
 */
export function withoutFormatOfEmpty<T extends { path: readonly (string | number)[]; message: string }>(
  issues: readonly T[],
): T[] {
  const empty = new Set(issues.filter((i) => /^must not be empty$/.test(i.message)).map((i) => i.path.join('\u0000')));

  return issues.filter((i) => !(/^must match /.test(i.message) && empty.has(i.path.join('\u0000'))));
}

/** One row of the Kind step's table. */
export interface KindRow {
  kind: string;
  /** Readable name ("DNS zone"). */
  name: string;
  description: string;
  scope: KindScope;
  icon: string;
}

/** A kind's icon: the Create ▾ icon, else the resource tree's. */
export function kindIconOf(kind: string): string {
  return CREATE_KINDS.find((k) => k.kind === kind)?.icon ?? resourceKindIcon(kind);
}

/** Whether Enter in `target` should move the wizard on (not in multi-line fields, the code editor, buttons, links). */
export function wizardEnterTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  return !target.closest('textarea, button, a, select, [role="button"], .monaco-editor, fpc-code-editor');
}

/**
 * Resource create / edit modal (3.37 / 3.38; user 2026-10-29 "like Order plan"): Decabill's order wizard — an xl
 * `fpc-modal` (no fullscreen) with the numbered step indicator (done / current / upcoming), the step in a tertiary
 * card, a sidebar with what goes into the draft, and Back (left) · Next / "Add to draft" (right) in the footer; Next
 * only when the step is valid (its problems show at the fields and in the step alert). Steps: [Kind] → General (name,
 * project, untyped fields) → the kind's typed steps (generated form from `GET /schemas/{kind}`, every list / map /
 * union editable) → Review (a readable summary; the YAML behind "Show YAML"). Form | YAML at every step (the same
 * document, two-way; a Deployment's compose file in its own editor). Editing reuses the modal, pre-filled with the
 * drafted or live document; a rename also deletes the old resource. Nothing is applied: changes go into the active
 * draft ("Plan now" plans directly). Closing with changes asks first (`guardClose`): the modal hides, "Discard changes?"
 * takes its place, "Keep editing" brings it back as it was (`FpcModalSwap`, the Agenstra modal swap).
 */
@Component({
  selector: 'loadweaver-resource-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FpcStepStripComponent,
    FpcStepStripDirective,
    FormsModule,
    RouterLink,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcCodeEditorComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcTableCellDirective,
    LoadweaverSchemaFormComponent,
    LoadweaverVmRecommendedImagesComponent,
  ],
  providers: [
    {
      provide: SCHEMA_FORM_HOST,
      useFactory: () => {
        const modal = inject(LoadweaverResourceModalComponent);

        return { openYaml: () => modal.yaml.set(true) };
      },
    },
  ],
  templateUrl: './resource-modal.component.html',
  styleUrl: './resource-modal.component.scss',
})
export class LoadweaverResourceModalComponent {
  private readonly service = inject(ResourceModalService);
  private readonly resourcesApi = inject(ResourcesService);
  private readonly facade = inject(ConsoleResourcesFacade);
  private readonly accessFacade = inject(ConsoleAccessFacade);
  private readonly git = inject(ConsoleGitFacade);
  private readonly endpoints = inject(ConsoleEndpointService, { optional: true });
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly tray = inject(DraftTrayService);
  readonly draft = inject(WorkspaceDraftStore, { optional: true });

  private readonly resourceEditor = viewChild<FpcCodeEditorComponent>('resourceEditor');
  private readonly composeEditor = viewChild<FpcCodeEditorComponent>('composeEditor');
  private readonly body = viewChild<ElementRef<HTMLElement>>('stepBody');
  private readonly modalHost = viewChild(FpcModalComponent, { read: ElementRef });

  readonly kindInfos = toSignal(this.facade.kinds$, { initialValue: [] as ResourceKindInfo[] });
  readonly schemas = toSignal(this.facade.schemas$, { initialValue: {} as Record<string, JsonSchema> });
  readonly schemaErrors = toSignal(this.facade.schemaErrors$, { initialValue: {} as Record<string, string> });
  readonly planning = toSignal(this.facade.planning$, { initialValue: false });
  readonly planError = toSignal(this.facade.planError$, { initialValue: null });
  private readonly me = toSignal(this.accessFacade.me$, { initialValue: null });
  private readonly memberProjects = toSignal(this.accessFacade.projects$, { initialValue: [] as string[] });
  /** Projects of the declared resources (cluster roles see every project there). */
  private readonly resourceProjects = toSignal(this.facade.projects$, { initialValue: [] as string[] });
  private readonly gitConnections = toSignal(this.git.connections$, { initialValue: [] as GitConnection[] });

  readonly request = this.service.request;
  readonly isOpen = computed(() => this.request() !== null);
  readonly editing = computed(() => this.request()?.mode === 'edit');
  /** The edited resource (edit mode). */
  readonly original = computed<ResourceKey | null>(() => {
    const request = this.request();

    return request?.mode === 'edit' ? request.key : null;
  });
  /** Create opened without a kind: the first step chooses it. */
  readonly needsKind = computed(() => {
    const request = this.request();

    return request?.mode === 'create' && request.kind === null;
  });

  /** The chosen kind of a new resource. */
  readonly chosenKind = signal<string | null>(null);
  readonly text = signal('');
  /** The document as opened (null while the edited resource loads / before a kind is chosen). */
  readonly initialText = signal<string | null>(null);
  /** The live document of an edited resource (null for new ones / resources that exist only in the draft). */
  readonly liveText = signal<string | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly yaml = signal(false);
  /** YAML mode of a Deployment: the resource document or its compose file. */
  readonly document = signal<'resource' | 'compose'>('resource');
  readonly active = signal(0);
  readonly previewNow = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly discardOpen = signal(false);
  /** "Discard changes?" swaps with the modal (one modal at a time); the modal's content stays mounted meanwhile. */
  readonly closeSwap = new FpcModalSwap(this.discardOpen);
  /** The modal is shown: open and not hidden behind the discard confirm. */
  readonly modalShown = computed(() => this.isOpen() && !this.closeSwap.suspended());
  /** Review: the YAML disclosure. */
  readonly showYaml = signal(false);
  private planRequested = false;
  private loadToken = 0;
  /** The project a create flow without a kind was opened for (applied once the kind is chosen). */
  private pendingProject: string | null = null;

  readonly access = computed<WorkspaceAccess>(() => ({
    clusterRole: this.me()?.clusterRole ?? null,
    projects: this.me()?.projects ?? {},
    fleetMode: this.endpoints?.fleetMode ?? false,
  }));
  readonly declared = computed(() => documentRef(this.text()));
  readonly meta = computed(() => documentMetadata(this.text()));
  /**
   * The project's VM images (opens in a new tab): in fleet mode through the cluster entry link, since the new tab
   * doesn't share this tab's active cluster.
   */
  readonly imagesLink = computed(() => {
    const project = this.meta().project ?? '';
    const cluster = this.endpoints?.fleetMode ? this.endpoints.activeClusterId() : null;

    return cluster ? ['/clusters', cluster, 'resources', 'project', project] : ['/resources', 'project', project];
  });
  readonly kind = computed(() => this.declared()?.kind ?? this.chosenKind() ?? this.original()?.kind ?? '');
  readonly kindDescription = computed(() => this.kindInfos().find((k) => k.kind === this.kind())?.description ?? null);
  readonly schemaError = computed(() =>
    Object.prototype.hasOwnProperty.call(this.schemaErrors(), this.kind()) ? this.schemaErrors()[this.kind()] : null,
  );
  readonly schemaLoaded = computed(() => Object.prototype.hasOwnProperty.call(this.schemas(), this.kind()));
  /**
   * Kind step (user 2026-10-29: "offer all for selection"): every published kind as one row of a single-selection
   * table (icon + readable name, description, scope), by readable name; before the kinds load, the Create ▾ kinds.
   */
  readonly kindRows = computed<KindRow[]>(() => {
    const infos = this.kindInfos();
    const kinds =
      infos.length > 0 ? infos.map((k) => k.kind) : CREATE_KINDS.flatMap((k) => (k.kind === null ? [] : [k.kind]));

    return [...new Set(kinds)]
      .filter((kind) => isCreatableKind(kind))
      .map((kind) => ({
        kind,
        name: this.kindName(kind),
        description: infos.find((k) => k.kind === kind)?.description ?? '',
        scope: kindScope(kind),
        icon: kindIconOf(kind),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
  /** The kind table's search ("Search kinds"): readable name, kind id, description or scope. */
  readonly kindQuery = signal('');
  readonly shownKindRows = computed(() => {
    const query = this.kindQuery().trim().toLowerCase();

    if (!query) return this.kindRows();

    return this.kindRows().filter((row) =>
      [row.name, row.kind, row.description, this.kindScopeLabel(row.scope)].some((text) =>
        text.toLowerCase().includes(query),
      ),
    );
  });
  /** The kind table's selection (`selectionMode="single"`): the chosen kind. */
  readonly kindSelection = computed<readonly string[]>(() => {
    const kind = this.chosenKind();

    return kind ? [kind] : [];
  });
  readonly kindRowId = (row: KindRow) => row.kind;
  readonly kindColumns: FpcTableColumn<KindRow>[] = [
    {
      id: 'name',
      label: $localize`:@@lwConsoleResourceEditor-kind:Kind`,
      value: (row) => row.name,
      required: true,
      priority: 1,
    },
    {
      id: 'description',
      label: $localize`:@@lwConsoleResourceModal-colKindDescription:Description`,
      value: (row) => row.description,
      priority: 1,
    },
    {
      id: 'scope',
      label: $localize`:@@lwConsoleResourceModal-colKindScope:Scope`,
      value: (row) => this.kindScopeLabel(row.scope),
      priority: 1,
    },
  ];
  /** Where resources of the kind live: cluster-level only, a project, or either. */
  readonly scope = computed(() => kindScope(this.kind()));
  readonly projectMissing = computed(() => this.scope() === 'project' && !this.meta().project);
  readonly projectError = computed(() => (this.projectMissing() ? this.projectRequiredLabel : null));
  /** Projects the caller may put this kind into (developer+; cluster roles: every project). */
  readonly projects = computed(() => {
    const kind = this.kind();
    const all = new Set([
      ...this.memberProjects(),
      ...Object.keys(this.me()?.projects ?? {}),
      ...(this.me()?.clusterRole ? (this.resourceProjects() ?? []) : []),
    ]);
    const current = this.meta().project;

    if (current) all.add(current);

    return [...all].filter((p) => mayDraftResource({ kind, project: p }, this.access()) || p === current).sort();
  });
  readonly clusterLevelAllowed = computed(
    () => this.scope() !== 'project' && mayDraftResource({ kind: this.kind(), project: null }, this.access()),
  );
  /** Role gating (3.17): the caller may change this resource (and, after a rename, its new scope). */
  readonly permitted = computed(() => {
    const declared = this.declared();
    const original = this.original();
    const kind = this.kind();

    if (!kind) return true;

    if (original && !mayDraftResource(original, this.access())) return false;

    return mayDraftResource({ kind, project: declared?.project ?? this.meta().project }, this.access());
  });

  readonly kindSchema = computed(() => this.schemas()[this.kind()] ?? null);
  readonly specNode = computed(() => specSchema(this.kindSchema()));
  readonly wizard = computed(() => [
    ...(this.needsKind() ? [KIND_STEP] : []),
    ...wizardSteps(this.kind(), this.kind() ? specKeys(this.specNode()) : []),
  ]);
  readonly step = computed(() => this.wizard()[this.active()] ?? null);
  readonly isDeployment = computed(() => this.kind() === 'Deployment');
  readonly compose = computed(() => (this.isDeployment() ? composeOf(this.text()) : null));

  readonly validate = computed(() => {
    const schemas = this.schemas();
    const kinds = this.kindInfos().map((k) => k.kind);

    return fpcYamlValidator((document) => checkResourceDocument(document, schemas, kinds));
  });
  readonly validateCompose = fpcYamlValidator(checkComposeDocument);
  /** Compiler diagnostics of the documents (computed here, so form steps validate without a mounted editor). */
  readonly problems = computed<ResourceModalProblem[]>(() => {
    if (this.initialText() === null) return [];

    const compose = this.compose();

    return [
      ...this.validate()(this.text(), 'yaml').map((d) => ({ ...d, source: 'resource' as const })),
      ...(this.isDeployment() && compose !== null
        ? this.validateCompose(compose, 'yaml').map((d) => ({ ...d, source: 'compose' as const }))
        : []),
    ];
  });
  readonly errorCount = computed(() => this.problems().filter((p) => p.severity === 'error').length);
  /** Schema / syntax issues by document path, each with its step (stepper marks and step alerts). */
  readonly issues = computed<ResourceModalIssue[]>(() => {
    if (this.initialText() === null || !this.kind()) return [];

    const steps = this.wizard();
    const doc = parseDocument(this.text());

    if (doc.errors.length > 0) {
      return [{ path: [], raw: doc.errors[0].message, message: doc.errors[0].message, step: 'review' }];
    }

    const kinds = this.kindInfos().map((k) => k.kind);
    const kind = this.kind();
    const composeStep = stepOfIssue(steps, ['spec', 'compose']);
    const composeErrors = this.problems()
      .filter((p) => p.source === 'compose' && p.severity === 'error')
      .map((p) => ({
        path: ['spec', 'compose'],
        raw: p.message,
        message: `${this.composeTab}: ${p.message}`,
        step: composeStep,
      }));

    return [
      ...withoutFormatOfEmpty(checkResourceDocument(doc.toJS(), this.schemas(), kinds)).map((issue) => ({
        path: issue.path,
        raw: issue.message,
        message: issue.path[0] === 'spec' ? readableIssue(issue.path, issue.message, kind) : this.envelopeIssue(issue),
        step: stepOfIssue(steps, issue.path, issue.message),
      })),
      ...composeErrors,
    ];
  });
  readonly stepIssues = computed(() => this.issues().filter((i) => i.step === this.step()?.id));
  /** The spec problems for the form's fields (paths below `spec`, raw messages). */
  readonly fieldIssues = computed<SchemaFieldIssue[]>(() =>
    this.issues()
      .filter((i) => i.path[0] === 'spec')
      .map((i) => ({ path: i.path.slice(1), message: i.raw })),
  );
  /** The spec as data (null while the YAML doesn't parse). */
  readonly specValue = computed(() => formSpec(this.text()));
  /** Review: each step's fields as a readable summary (no raw paths, enum values or YAML). */
  readonly reviewSections = computed<ResourceModalReviewSection[]>(() => {
    const spec = this.specNode();
    const value = this.specValue();

    if (!spec || value === null) return [];

    return this.wizard()
      .filter((s) => s.keys.length > 0)
      .map((s) => ({ id: s.id, label: s.label, rows: summarize(spec, value, s.keys, this.kind()) }))
      .filter((s) => s.rows.length > 0);
  });
  readonly stepNumber = computed(() =>
    SCHEMA_TEXT.stepOf.replace('{n}', String(this.active() + 1)).replace('{total}', String(this.wizard().length)),
  );
  readonly nameError = computed(() =>
    this.meta().name && !validResourceName(this.meta().name) ? this.nameInvalid : null,
  );

  readonly dirty = computed(() => this.initialText() !== null && this.text() !== this.initialText());
  /** Editing changed the kind, name or project: the draft creates the new resource and deletes the old one. */
  readonly renamed = computed(() => {
    const original = this.original();
    const declared = this.declared();

    return !!original && !!declared && !sameResourceKey(original, declared);
  });
  readonly changed = computed(() => !this.editing() || this.dirty() || this.renamed());

  readonly stepperSteps = computed<FpcStep[]>(() =>
    this.wizard().map((s) => ({
      id: s.id,
      label: s.label,
      invalid: this.stepInvalid(s.id),
    })),
  );
  /** Whether a step indicator may be clicked (back always; forward only over valid steps). */
  readonly reachable = (index: number): boolean =>
    index <= this.active() ||
    !this.stepperSteps()
      .slice(0, index)
      .some((s) => s.invalid);
  readonly isLast = computed(() => this.active() >= this.wizard().length - 1);
  /**
   * YAML is one page (user, 2026-10-29: "In YAML mode there are no steps"): no step list, no "Step X of Y", the final
   * actions right away; Back only leads to the Kind step. Form returns to the step it was on.
   */
  readonly yamlPage = computed(() => this.yaml() && this.initialText() !== null && this.step()?.id !== 'kind');
  readonly kindStepIndex = computed(() => this.wizard().findIndex((s) => s.id === 'kind'));
  /** The footer shows Plan now / Add to draft (the last step, or the YAML page). */
  readonly finishing = computed(() => this.isLast() || this.yamlPage());
  readonly mayGoBack = computed(() => (this.yamlPage() ? this.kindStepIndex() >= 0 : this.active() > 0));
  readonly canNext = computed(() => !this.isLast() && !this.stepperSteps()[this.active()]?.invalid);
  readonly canFinish = computed(() => !!this.draft && !this.busy() && this.stepperSteps().every((s) => !s.invalid));
  readonly canPlan = computed(() => this.canFinish() && !this.planning());

  /** Git-authoritative scopes the change touches: "Plan now" opens a pull request there (3.29). */
  readonly gitAuthoritative = computed(() => {
    const declared = this.declared();
    const original = this.original();
    const touched = [
      ...(declared ? [{ action: 'update' as const, project: declared.project }] : []),
      ...(original && this.renamed() ? [{ action: 'delete' as const, project: original.project }] : []),
    ];

    return authoritativeConnectionsOf(touched, this.gitConnections());
  });
  /** Review: what goes into the draft. */
  readonly summary = computed<FpcKeyValueItem[]>(() => {
    const declared = this.declared();
    const active = this.draft?.active() ?? null;

    return [
      {
        key: 'change',
        label: this.changeLabel,
        value: !this.editing() ? this.actionCreate : this.renamed() ? this.actionRename : this.actionUpdate,
      },
      { key: 'kind', label: this.kindLabel, value: this.kindTitle() },
      { key: 'name', label: this.nameLabel, value: declared?.name || '—', mono: true },
      {
        key: 'project',
        label: this.projectLabel,
        value: declared?.project ?? (!this.kind() || this.scope() === 'project' ? '—' : this.clusterLevelLabel),
      },
      { key: 'draft', label: this.draftTargetLabel, value: active?.title || this.newDraftLabel },
    ];
  });
  readonly lineDiff = computed<SpecLineDiff>(() => {
    const live = this.liveText();

    return live !== null ? specLineDiff(live, this.text()) : { live: [], draft: [] };
  });
  /** One general title per mode (user, 2026-10-29): kind, name and project show in the sidebar. */
  readonly title = computed(() => (this.original() ? this.editAnyLabel : this.createAnyLabel));
  readonly editorHeight = '24rem';
  /** The kind's readable name (the Create ▾ label, else the kind). */
  readonly kindTitle = computed(() => this.kindName(this.kind()));
  readonly kindIcon = computed(() => kindIconOf(this.kind()));

  readonly label = resourceLabel;
  readonly scopeLabel = gitScopeLabel;
  readonly problemColumns: FpcTableColumn<ResourceModalProblem>[] = [
    {
      id: 'severity',
      label: $localize`:@@lwConsoleResourceEditor-colSeverity:Severity`,
      type: 'state',
      state: (p) =>
        p.severity === 'error'
          ? { label: $localize`:@@lwConsoleResourceEditor-severityError:Error`, tone: 'danger' }
          : { label: $localize`:@@lwConsoleResourceEditor-severityWarning:Warning`, tone: 'warning' },
    },
    {
      id: 'message',
      label: $localize`:@@lwConsoleResourceEditor-colProblem:Problem`,
      value: (p) => p.message,
      required: true,
      priority: 1,
    },
    {
      id: 'where',
      label: $localize`:@@lwConsoleResourceEditor-colWhere:Where`,
      value: (p) => `${p.source === 'compose' ? this.composeTab + ' ' : ''}${p.line}:${p.column}`,
      sortable: false,
      priority: 1,
    },
  ];
  readonly problemId = (p: ResourceModalProblem) => `${p.source}:${p.line}:${p.column}:${p.message}`;

  readonly createAnyLabel = $localize`:@@lwConsoleResourceModal-createAny:Create resource`;
  readonly editAnyLabel = $localize`:@@lwConsoleResourceModal-editAny:Edit resource`;
  readonly nameLabel = $localize`:@@lwConsoleWorkspace-name:Name`;
  readonly projectLabel = $localize`:@@lwConsoleResourceEditor-project:Project`;
  readonly kindLabel = $localize`:@@lwConsoleResourceEditor-kind:Kind`;
  readonly kindsLabel = $localize`:@@lwConsoleResourceModal-kinds:Resource kinds`;
  readonly searchKindsLabel = $localize`:@@lwConsoleResourceModal-searchKinds:Search kinds`;
  private readonly scopeLabels: Record<KindScope, string> = {
    cluster: $localize`:@@lwConsoleResourceModal-scopeCluster:Cluster`,
    project: $localize`:@@lwConsoleResourceModal-scopeProject:Project`,
    any: $localize`:@@lwConsoleResourceModal-scopeAny:Cluster or project`,
  };
  readonly chooseLabel = $localize`:@@lwConsoleResourceModal-choose:Choose…`;
  readonly clusterLevelLabel = $localize`:@@lwConsoleResources-clusterLevel:Cluster-level`;
  readonly formLabel = $localize`:@@lwConsoleWorkspace-form:Form`;
  readonly yamlLabel = $localize`:@@lwConsoleWorkspace-yaml:YAML`;
  readonly modeLabel = $localize`:@@lwConsoleResourceEditor-mode:Edit as`;
  readonly documentLabel = $localize`:@@lwConsoleResourceEditor-document:Document`;
  readonly resourceTab = $localize`:@@lwConsoleResourceEditor-resourceTab:Resource`;
  readonly composeTab = $localize`:@@lwConsoleResourceEditor-composeTab:Compose file`;
  readonly problemsTitle = $localize`:@@lwConsoleResourceEditor-problems:Problems`;
  readonly addToDraftLabel = $localize`:@@lwConsoleWizard-addToDraft:Add to draft`;
  readonly saveToDraftLabel = $localize`:@@lwConsoleWorkspace-saveToDraft:Save to draft`;
  readonly backLabel = $localize`:@@lwConsoleWizard-back:Back`;
  readonly nextLabel = $localize`:@@lwConsoleWizard-next:Next`;
  readonly cancelLabel = $localize`:@@lwConsoleResourceModal-cancel:Cancel`;
  readonly previewLabel = $localize`:@@lwConsoleWizard-previewNow:Preview now (dry run in the draft tray)`;
  readonly nameInvalid = $localize`:@@lwConsoleWizard-nameInvalid:Lower-case letters, digits and "-", up to 63 characters.`;
  readonly loadingLabel = $localize`:@@lwConsoleResourceEditor-loading:Loading the resource`;
  readonly liveLabel = $localize`:@@lwConsoleResourceEditor-live:Live`;
  readonly draftLabel = $localize`:@@lwConsoleWorkspace-draft:Draft`;
  readonly changeLabel = $localize`:@@lwConsoleResourceModal-change:Change`;
  readonly actionCreate = $localize`:@@lwConsoleResourceModal-actionCreate:Create`;
  readonly actionUpdate = $localize`:@@lwConsoleResourceModal-actionUpdate:Update`;
  readonly actionRename = $localize`:@@lwConsoleResourceModal-actionRename:Rename (delete and create)`;
  readonly resourceLabelText = $localize`:@@lwConsoleResourceEditor-resourceTab:Resource`;
  readonly draftTargetLabel = $localize`:@@lwConsoleResourceModal-draftTarget:Goes into`;
  readonly newDraftLabel = $localize`:@@lwConsoleResourceModal-newDraft:A new draft`;
  readonly stepErrorsLabel = $localize`:@@lwConsoleResourceModal-stepErrors:Fix these problems to continue`;
  readonly forbiddenLabel = $localize`:@@lwConsoleResourceModal-forbidden:Your role may not change resources of this kind in this scope.`;
  readonly unchangedLabel = $localize`:@@lwConsoleResourceModal-unchanged:Nothing changed yet.`;
  readonly loadFailedLabel = $localize`:@@lwConsoleResourceModal-loadFailed:The resource could not be loaded.`;
  readonly discardTitle = $localize`:@@lwConsoleResourceModal-discardTitle:Discard changes?`;
  readonly discardMessage = $localize`:@@lwConsoleResourceModal-discardMessage:Your changes in this dialog are not in the draft yet. Close it and discard them?`;
  readonly discardLabel = $localize`:@@lwConsoleResourceModal-discard:Discard`;
  readonly keepEditingLabel = $localize`:@@lwConsoleResourceModal-keepEditing:Keep editing`;
  readonly projectRequiredLabel = $localize`:@@lwConsoleResourceModal-projectRequired:Resources of this kind belong to a project: choose one.`;
  readonly reviewTitle = SCHEMA_TEXT.reviewTitle;
  readonly reviewEmpty = SCHEMA_TEXT.reviewEmpty;
  readonly showYamlLabel = SCHEMA_TEXT.showYaml;
  readonly statusLabel = SCHEMA_TEXT.statusLabel;
  readonly statusReady = SCHEMA_TEXT.statusReady;
  readonly aboutKindLabel = SCHEMA_TEXT.aboutKind;
  /** Sidebar state: ready, n problems, or required input (name / project) still missing. */
  readonly status = computed<'ready' | 'problems' | 'incomplete'>(() => {
    if (this.issues().length > 0) return 'problems';

    return this.stepperSteps().some((s) => s.id !== 'review' && s.invalid) ? 'incomplete' : 'ready';
  });
  readonly statusIncomplete = SCHEMA_TEXT.statusIncomplete;
  readonly statusProblems = computed(() => SCHEMA_TEXT.statusProblems.replace('{n}', String(this.issues().length)));
  private readonly failedLabel = $localize`:@@lwConsoleWizard-failed:The draft could not be saved.`;

  constructor() {
    // Every open starts fresh: a template of the kind (create) or the drafted / live document (edit).
    effect(() => {
      const request = this.request();

      untracked(() => this.reset(request));
    });

    // Each kind's JSON Schema is read once, as soon as the document names it.
    effect(() => {
      const kind = this.kind();

      if (kind && this.isOpen()) untracked(() => this.facade.loadSchema(kind));
    });

    // A new, untouched document gets the schema's required fields (defaults, first options) once its schema is in.
    effect(() => {
      const spec = this.specNode();
      const initial = this.initialText();

      if (!spec || initial === null || this.editing()) return;

      untracked(() => {
        if (this.text() !== initial) return;

        const value = formSpec(initial);

        if (value === null) return;

        const filled = withFormSpec(initial, fillRequired(spec, value));

        if (filled !== initial) {
          this.text.set(filled);
          this.initialText.set(filled);
        }
      });
    });

    // "Plan now" succeeded (the plan page opens): the modal closes.
    effect(() => {
      const planning = this.planning();
      const error = this.planError();

      if (!planning && this.planRequested) {
        this.planRequested = false;

        if (!error) untracked(() => this.service.close());
      }
    });

    // Edit on a given step: jump there once the document is loaded and the kind's steps include it.
    effect(() => {
      const step = this.pendingStep();
      const index = step && this.initialText() !== null ? this.wizard().findIndex((s) => s.id === step) : -1;

      if (index >= 0)
        untracked(() => {
          this.active.set(index);
          this.pendingStep.set(null);
        });
    });

    // Focus follows the step (first control of its body).
    effect(() => {
      this.active();
      this.yaml();

      if (!this.isOpen() || this.initialText() === null) return;

      afterNextRender(
        () => this.body()?.nativeElement.querySelector<HTMLElement>('input:not(:disabled), select, textarea')?.focus(),
        {
          injector: this.injector,
        },
      );
    });
  }

  private stepInvalid(id: string): boolean {
    const loaded = this.initialText() !== null;

    switch (id) {
      case 'kind':
        return !this.chosenKind() || !loaded;
      case 'general':
        return (
          !loaded ||
          !validResourceName(this.meta().name) ||
          this.projectMissing() ||
          !this.permitted() ||
          this.hasIssues('general')
        );
      case 'review':
        return (
          !loaded ||
          !this.declared() ||
          this.errorCount() > 0 ||
          !this.permitted() ||
          !this.changed() ||
          this.hasIssues('review')
        );
      default:
        return !loaded || this.hasIssues(id);
    }
  }

  private hasIssues(step: string): boolean {
    return this.issues().some((issue) => issue.step === step);
  }

  /** Edit opened on a step (`openEdit(key, step)`): taken once the document and the kind's steps are known. */
  private readonly pendingStep = signal<string | null>(null);

  private reset(request: ResourceModalRequest | null): void {
    const token = ++this.loadToken;

    this.pendingStep.set(null);

    this.active.set(0);
    this.yaml.set(false);
    this.document.set('resource');
    this.error.set(null);
    this.busy.set(false);
    this.showYaml.set(false);
    this.closeSwap.finish();
    this.loadError.set(null);
    this.liveText.set(null);
    this.initialText.set(null);
    this.text.set('');
    this.chosenKind.set(null);
    this.kindQuery.set('');
    this.planRequested = false;

    if (!request) return;

    this.facade.loadKinds();
    this.facade.clearPlanError();
    this.git.load(true);

    if (request.mode === 'create') {
      this.previewNow.set(true);

      this.pendingProject = request.project;

      if (request.kind) this.startNew(request.kind, request.project);

      return;
    }

    this.previewNow.set(false);
    this.pendingStep.set(request.step ?? null);
    void this.loadEdit(request.key, token);
  }

  /** A new document of `kind` (project preset, else the first project the caller may use when cluster-level isn't). */
  private startNew(kind: string, project: string | null): void {
    this.chosenKind.set(kind);

    const scope =
      project ??
      (kindScope(kind) !== 'project' && mayDraftResource({ kind, project: null }, this.access())
        ? null
        : (this.projects().find((p) => mayDraftResource({ kind, project: p }, this.access())) ?? null));
    const text = resourceTemplate(kind, kindScope(kind) === 'cluster' ? null : scope);

    this.text.set(text);
    this.initialText.set(text);
  }

  /** Edit: the draft's version of the resource if it has one, else the live one (always a fresh GET). */
  private async loadEdit(key: ResourceKey, token: number): Promise<void> {
    const drafted = draftOpOf(this.draft?.active() ?? null, key);
    let live: string | null = null;

    try {
      live = resourceToYaml(await firstValueFrom(this.resourcesApi.get(key)));
    } catch {
      live = null;
    }

    if (token !== this.loadToken) return;

    const start = drafted?.op === 'upsert' && drafted.document ? drafted.document : live;

    if (start === null) {
      this.loadError.set(this.loadFailedLabel);

      return;
    }

    this.liveText.set(live);
    this.initialText.set(start);
    this.text.set(start);
  }

  kindScopeLabel(scope: KindScope): string {
    return this.scopeLabels[scope];
  }

  /** Kind table: the radio selection picks the kind. */
  onKindSelection(ids: readonly string[]): void {
    if (ids[0]) this.chooseKind(ids[0]);
  }

  /** Kind table: Enter / double click pick the kind and move on. */
  onKindActivate(row: KindRow): void {
    this.chooseKind(row.kind);
    this.next();
  }

  /** Kind step: a new template of the chosen kind (keeps the preset project). */
  chooseKind(kind: string): void {
    if (!kind || kind === this.chosenKind()) return;

    this.startNew(kind, this.meta().project ?? this.pendingProject);
  }

  setName(name: string): void {
    this.text.set(withDocumentMetadata(this.text(), name.trim(), this.meta().project));
  }

  /** Envelope problems (name, project, kind) in words. */
  private envelopeIssue(issue: { path: readonly (string | number)[]; message: string }): string {
    const where =
      issue.path[0] === 'metadata' ? (issue.path[1] === 'project' ? this.projectLabel : this.nameLabel) : '';

    return where ? `${where}: ${issue.message}` : issue.message;
  }

  /** A kind's readable name ("DNS zone"; unknown kinds as they are). */
  kindName(kind: string): string {
    return Object.prototype.hasOwnProperty.call(SCHEMA_KIND_LABELS, kind) ? SCHEMA_KIND_LABELS[kind] : kind;
  }

  /** The VM image picked under "Recommended images" (3.42) into `spec.image`. */
  setVmImage(reference: string): void {
    this.text.set(withSpecField(this.text(), 'image', reference));
  }

  setProject(project: string): void {
    this.text.set(withDocumentMetadata(this.text(), this.meta().name, project || null));
  }

  onComposeChange(compose: string): void {
    const next = withCompose(this.text(), compose);

    if (next !== null) this.text.set(next);
  }

  goTo(index: number): void {
    const steps = this.stepperSteps();

    if (index < 0 || index >= steps.length) return;

    // Linear: forward only over valid steps.
    if (!this.reachable(index)) return;

    this.active.set(index);
  }

  next(): void {
    if (this.canNext()) this.active.update((i) => i + 1);
  }

  back(): void {
    if (this.yamlPage()) {
      // The YAML page has no steps to go back through: only the kind can change.
      if (this.kindStepIndex() >= 0) this.active.set(this.kindStepIndex());

      return;
    }

    if (this.active() > 0) this.active.update((i) => i - 1);
  }

  /** Enter moves on (Next / finish) unless the focus is in a multi-line field, the code editor or on a button. */
  onEnter(event: Event): void {
    // Already handled further in (e.g. the kind table's row Enter picks and moves on itself).
    if (event.defaultPrevented || !wizardEnterTarget(event.target)) return;

    event.preventDefault();

    if (this.finishing()) void this.finish();
    else this.next();
  }

  reveal(problem: ResourceModalProblem): void {
    this.yaml.set(true);

    if (problem.source === 'compose') {
      this.document.set('compose');
      afterNextRender(() => this.composeEditor()?.revealPosition(problem.line, problem.column), {
        injector: this.injector,
      });
    } else {
      this.document.set('resource');
      afterNextRender(() => this.resourceEditor()?.revealPosition(problem.line, problem.column), {
        injector: this.injector,
      });
    }
  }

  /** X / Escape / backdrop / Cancel: with unsaved changes ask first. */
  requestClose(): void {
    if (this.busy()) return;

    if (this.discardOpen() || this.closeSwap.suspended()) return;

    if (this.dirty()) this.closeSwap.toOverlay(this.modalHost()?.nativeElement);
    else this.service.close();
  }

  /** "Keep editing" (also X / Escape / backdrop of the confirm): the modal comes back as it was. */
  keepEditing(): void {
    this.closeSwap.back(this.modalHost()?.nativeElement);
  }

  discard(): void {
    this.closeSwap.finish();
    this.service.close();
  }

  /**
   * "Add to draft" / "Save to draft": the document into the active draft (a new one if none is open), a rename also
   * deletes the old resource; "Preview now" runs the dry run and opens the tray. New / renamed resources open their
   * object page.
   */
  async finish(): Promise<void> {
    const store = this.draft;
    const ref = this.declared();

    if (!store || !ref || !this.canFinish()) return;

    const original = this.original();
    const renamed = this.renamed();
    const document = this.text();

    this.busy.set(true);
    this.error.set(null);

    try {
      // The server records the base generation of the op (optimistic concurrency, 3.36).
      if (!(await store.upsert(document))) {
        this.error.set(store.error() ?? this.failedLabel);

        return;
      }

      if (original && renamed) await store.remove(original);

      if (this.previewNow()) {
        await store.runPreview();
        this.tray.open.set(true);
      }

      this.busy.set(false);
      this.service.close();

      if (!original || renamed) void this.router.navigate([...resourceObjectRoute(ref)]);
    } finally {
      this.busy.set(false);
    }
  }

  /** "Plan now": plans the document directly (a rename also deletes the old resource); the plan opens on success. */
  planNow(): void {
    if (!this.canPlan()) return;

    const original = this.original();
    const request: CreatePlanRequest = { documents: this.text() };

    if (original && this.renamed()) {
      request.delete = [
        { kind: original.kind, name: original.name, ...(original.project ? { project: original.project } : {}) },
      ];
    }

    this.planRequested = true;
    this.facade.plan(request);
  }

  dismissPlanError(): void {
    this.facade.clearPlanError();
  }
}
