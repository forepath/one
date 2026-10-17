import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  checkComposeDocument,
  checkResourceDocument,
  composeOf,
  hasOwnKey,
  authoritativeConnectionsOf,
  ConsoleAccessFacade,
  ConsoleGitFacade,
  ConsoleResourcesFacade,
  type CreatePlanRequest,
  type GitConnection,
  type JsonSchema,
  type ResourceKey,
  resourceKeyOf,
  resourceKeyOfResource,
  type ResourceKindInfo,
  resourceTemplate,
  resourceToYaml,
  sameResourceKey,
  withCompose,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  type FpcCodeDiagnostic,
  FpcCodeEditorComponent,
  FpcPageHeaderComponent,
  FpcSpinnerComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  fpcYamlValidator,
} from '@forepath/shared/frontend/ui-components';
import { combineLatest } from 'rxjs';

import { gitScopeLabel } from '../git/git-format';
import { routeResourceKey } from './resource-detail-page.component';
import { kindIcon, projectParams, resourceLabel, resourceLink } from './resource-format';

/** Where a diagnostic is shown: the resource YAML or a Deployment's compose file. */
export type EditorDiagnostic = FpcCodeDiagnostic & { source: 'resource' | 'compose' };

/**
 * The resource editor (3.16): a resource as YAML in Monaco, validated against the published JSON Schema of its kind,
 * and a Deployment's compose file in its own editor. Saving never writes: it plans the change (`POST /plans`) and
 * opens the plan for review. A changed kind, name or project plans a rename (the old resource is deleted). In a
 * Git-authoritative scope (3.29) the control plane turns that plan into a pull request; the plan links it.
 */
@Component({
  selector: 'loadweaver-resource-editor-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcCodeEditorComponent,
    FpcPageHeaderComponent,
    FpcSpinnerComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
  ],
  templateUrl: './resource-editor-page.component.html',
  standalone: true,
})
export class LoadweaverResourceEditorPageComponent implements OnInit {
  private readonly facade = inject(ConsoleResourcesFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly git = inject(ConsoleGitFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  private readonly resourceEditor = viewChild<FpcCodeEditorComponent>('resourceEditor');
  private readonly composeEditor = viewChild<FpcCodeEditorComponent>('composeEditor');

  readonly kindInfos = toSignal(this.facade.kinds$, { initialValue: [] as ResourceKindInfo[] });
  readonly schemas = toSignal(this.facade.schemas$, { initialValue: {} as Record<string, JsonSchema> });
  readonly schemaErrors = toSignal(this.facade.schemaErrors$, { initialValue: {} as Record<string, string> });
  readonly selected = toSignal(this.facade.selected$, { initialValue: null });
  readonly selectedLoading = toSignal(this.facade.selectedLoading$, { initialValue: false });
  readonly selectedError = toSignal(this.facade.selectedError$, { initialValue: null });
  readonly planning = toSignal(this.facade.planning$, { initialValue: false });
  readonly planError = toSignal(this.facade.planError$, { initialValue: null });
  readonly projects = toSignal(this.access.projects$, { initialValue: [] as string[] });
  private readonly gitConnections = toSignal(this.git.connections$, { initialValue: [] as GitConnection[] });

  /** The edited resource; null for a new one. */
  readonly original = signal<ResourceKey | null>(null);
  /** The kind a new resource starts with. */
  readonly newKind = signal('Deployment');
  readonly newProject = signal<string | null>(null);
  readonly text = signal('');
  /** The text as loaded (null while the edited resource is loading). */
  readonly initialText = signal<string | null>(null);
  readonly diagnostics = signal<FpcCodeDiagnostic[]>([]);
  readonly composeDiagnostics = signal<FpcCodeDiagnostic[]>([]);
  readonly activeTab = signal<string | null>('resource');

  readonly declared = computed(() => resourceKeyOf(this.text()));
  readonly kind = computed(() => this.declared()?.kind ?? this.original()?.kind ?? this.newKind());
  readonly kindDescription = computed(() => this.kindInfos().find((k) => k.kind === this.kind())?.description ?? null);
  readonly schemaError = computed(() =>
    hasOwnKey(this.schemaErrors(), this.kind()) ? this.schemaErrors()[this.kind()] : null,
  );
  readonly schemaLoaded = computed(() => hasOwnKey(this.schemas(), this.kind()));
  readonly isDeployment = computed(() => this.kind() === 'Deployment');
  readonly compose = computed(() => (this.isDeployment() ? composeOf(this.text()) : null));
  readonly validate = computed(() => {
    const schemas = this.schemas();
    const kinds = this.kindInfos().map((k) => k.kind);

    return fpcYamlValidator((document) => checkResourceDocument(document, schemas, kinds));
  });
  readonly validateCompose = fpcYamlValidator(checkComposeDocument);
  readonly problems = computed<EditorDiagnostic[]>(() => [
    ...this.diagnostics().map((d) => ({ ...d, source: 'resource' as const })),
    ...(this.isDeployment() ? this.composeDiagnostics().map((d) => ({ ...d, source: 'compose' as const })) : []),
  ]);
  readonly errorCount = computed(() => this.problems().filter((d) => d.severity === 'error').length);
  readonly dirty = computed(() => this.initialText() !== null && this.text() !== this.initialText());
  /** Editing changed the kind, name or project: the plan creates the new resource and deletes the old one. */
  readonly renamed = computed(() => {
    const original = this.original();
    const declared = this.declared();

    return !!original && !!declared && !sameResourceKey(original, declared);
  });
  readonly canPlan = computed(
    () =>
      this.initialText() !== null &&
      !!this.declared() &&
      this.errorCount() === 0 &&
      (this.original() === null || this.dirty()) &&
      !this.planning(),
  );
  /** Git-authoritative scopes the save touches: it opens a pull request there instead of an applicable plan. */
  readonly gitAuthoritative = computed(() => {
    const declared = this.declared();
    const original = this.original();
    const touched = [
      ...(declared ? [{ action: 'update' as const, project: declared.project }] : []),
      ...(original && this.renamed() ? [{ action: 'delete' as const, project: original.project }] : []),
    ];

    return authoritativeConnectionsOf(touched, this.gitConnections());
  });
  readonly originalLabel = computed(() => {
    const original = this.original();

    return original ? resourceLabel(original) : '';
  });
  readonly heading = computed(() => {
    const original = this.original();

    return original ? `${this.editTitle} · ${resourceLabel(original)}` : this.newTitle;
  });

  readonly kindIcon = kindIcon;
  readonly label = resourceLabel;
  readonly scopeLabel = gitScopeLabel;

  readonly newTitle = $localize`:@@lwConsoleResourceEditor-newTitle:New resource`;
  readonly editTitle = $localize`:@@lwConsoleResourceEditor-editTitle:Edit`;
  readonly resourceTab = $localize`:@@lwConsoleResourceEditor-resourceTab:Resource`;
  readonly composeTab = $localize`:@@lwConsoleResourceEditor-composeTab:Compose file`;
  readonly kindLabel = $localize`:@@lwConsoleResourceEditor-kind:Kind`;
  readonly projectLabel = $localize`:@@lwConsoleResourceEditor-project:Project`;

  constructor() {
    // Each kind's JSON Schema is read once, as soon as the YAML names it.
    effect(() => {
      const kind = this.kind();

      if (kind) untracked(() => this.facade.loadSchema(kind));
    });

    // The edited resource fills the editor once it is loaded: only from the fresh GET (the store may still hold the
    // copy from an earlier visit while it runs — editing that could plan over newer changes).
    effect(() => {
      const resource = this.selected();
      const original = this.original();
      const loading = this.selectedLoading();

      if (loading || !original || !resource || !sameResourceKey(resourceKeyOfResource(resource), original)) return;

      untracked(() => {
        if (this.initialText() !== null) return;

        const yaml = resourceToYaml(resource);

        this.initialText.set(yaml);
        this.text.set(yaml);
      });
    });
  }

  ngOnInit(): void {
    this.facade.loadKinds();
    this.git.load(true);
    this.facade.clearPlanError();

    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([params, query]) => {
        const key = routeResourceKey(params, query);

        this.initialText.set(null);
        this.original.set(key);

        if (key) {
          this.facade.open(key);
        } else {
          this.newKind.set(query.get('kind') || 'Deployment');
          this.newProject.set(query.get('project') || null);
          this.startNew();
        }
      });
  }

  /** A new resource of another kind starts from that kind's template. */
  changeKind(kind: string): void {
    this.newKind.set(kind);
    this.startNew();
  }

  changeProject(project: string): void {
    this.newProject.set(project || null);
    this.startNew();
  }

  onTextChange(text: string): void {
    this.text.set(text);
  }

  /** The compose file is stored in `spec.compose` of the Deployment. */
  onComposeChange(compose: string): void {
    const next = withCompose(this.text(), compose);

    if (next !== null) this.text.set(next);
  }

  reveal(problem: EditorDiagnostic): void {
    if (problem.source === 'compose') {
      this.activeTab.set('compose');
      this.composeEditor()?.revealPosition(problem.line, problem.column);
    } else {
      this.activeTab.set('resource');
      this.resourceEditor()?.revealPosition(problem.line, problem.column);
    }
  }

  dismissPlanError(): void {
    this.facade.clearPlanError();
  }

  /** Plans the document (and the deletion of the old resource on a rename); the plan opens on success. */
  plan(): void {
    if (!this.canPlan()) return;

    const original = this.original();
    const request: CreatePlanRequest = { documents: this.text() };

    if (original && this.renamed()) {
      request.delete = [
        { kind: original.kind, name: original.name, ...(original.project ? { project: original.project } : {}) },
      ];
    }

    this.facade.plan(request);
  }

  cancel(): void {
    const original = this.original();

    void (original
      ? this.router.navigate(resourceLink(original), { queryParams: projectParams(original.project) })
      : this.router.navigate(['/resources']));
  }

  private startNew(): void {
    const text = resourceTemplate(this.newKind(), this.newProject());

    this.text.set(text);
    this.initialText.set(text);
  }
}
