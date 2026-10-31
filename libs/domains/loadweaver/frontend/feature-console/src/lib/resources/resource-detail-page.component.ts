import { CommonModule } from '@angular/common';
import {
  booleanAttribute,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  LOCALE_ID,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import {
  composeOf,
  ConsoleResourcesFacade,
  sameResourceKey,
  type ResourceKey,
  resourceToYaml,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcCodeEditorComponent,
  FpcEmptyStateComponent,
  fpcPlural,
  type FpcKeyValueItem,
  FpcKeyValueDirective,
  FpcKeyValueListComponent,
  FpcSectionRowComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';
import { combineLatest, distinctUntilChanged, map } from 'rxjs';

import { kindDisplayName, resourceDescription } from './resource-format';
import { specFacts } from './spec-facts';
import { LoadweaverLaneComponent } from '../section/lane.component';

/** The resource of `/resources/:kind/:name?project=`. */
export function routeResourceKey(
  params: { get(name: string): string | null },
  query: { get(name: string): string | null },
): ResourceKey | null {
  const kind = params.get('kind');
  const name = params.get('name');

  return kind && name ? { kind, name, project: query.get('project') || null } : null;
}

/**
 * One resource (3.29): its metadata and YAML (and a Deployment's compose file), read-only. Editing opens the editor;
 * deleting plans the deletion. Nothing is written without a plan. Autoscaling has its own object tab (3.38).
 */
@Component({
  selector: 'loadweaver-resource-detail-page',
  imports: [
    CommonModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcCodeEditorComponent,
    FpcEmptyStateComponent,
    FpcKeyValueDirective,
    FpcKeyValueListComponent,
    FpcSectionRowComponent,
    LoadweaverLaneComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
  ],
  // Fills its routed outlet / object page tab: the lanes scroll, not the page (3.37).
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  templateUrl: './resource-detail-page.component.html',
  standalone: true,
})
export class LoadweaverResourceDetailPageComponent implements OnInit {
  /** The resource to show (object pages); else the one of the route. */
  readonly resourceKey = input<ResourceKey | null>(null);
  /**
   * Summary of a kind that has its own Spec tab (LW-12b, 2026-10-29): readable settings instead of the YAML, which
   * the Spec tab already shows.
   */
  readonly settings = input(false, { transform: booleanAttribute });
  private readonly locale = inject(LOCALE_ID);
  private readonly keyInput$ = toObservable(this.resourceKey);
  private readonly facade = inject(ConsoleResourcesFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly resource = toSignal(this.facade.selected$, { initialValue: null });
  readonly loading = toSignal(this.facade.selectedLoading$, { initialValue: false });
  readonly error = toSignal(this.facade.selectedError$, { initialValue: null });
  readonly planning = toSignal(this.facade.planning$, { initialValue: false });
  readonly planError = toSignal(this.facade.planError$, { initialValue: null });

  readonly key = signal<ResourceKey | null>(null);
  readonly activeTab = signal<string | null>('yaml');
  /** Workbench (3.37): YAML main lane + metadata inspector; one at a time on phones. */
  readonly lane = signal<'yaml' | 'meta'>('yaml');
  /** The read-only YAML fills the main lane. */
  readonly editorHeight = 'calc(100vh - 16rem)';

  readonly yaml = computed(() => {
    const resource = this.resource();

    return resource ? resourceToYaml(resource) : '';
  });
  readonly compose = computed(() => (this.resource()?.kind === 'Deployment' ? composeOf(this.yaml()) : null));
  readonly description = computed(() => {
    const resource = this.resource();

    return resource ? resourceDescription(resource) : null;
  });
  /** Metadata facts (3.38: `fpc-key-value-list`; annotations as monospace rows). */
  readonly facts = computed<FpcKeyValueItem[]>(() => {
    const r = this.resource();

    if (!r) return [];

    const description = this.description();

    return [
      { key: 'kind', label: $localize`:@@lwConsoleResourceDetail-kind:Kind`, value: kindDisplayName(r.kind) },
      { key: 'name', label: $localize`:@@lwConsoleResourceDetail-name:Name`, value: r.metadata.name, mono: true },
      { key: 'project', label: $localize`:@@lwConsoleResourceDetail-project:Project` },
      ...(description
        ? [
            {
              key: 'description',
              label: $localize`:@@lwConsoleResourceDetail-description:Description`,
              value: description,
            },
          ]
        : []),
      { key: 'labels', label: $localize`:@@lwConsoleResourceDetail-labels:Labels` },
      ...Object.entries(r.metadata.annotations ?? {}).map(([key, value]) => ({
        key: `annotation:${key}`,
        label: key,
        value: String(value),
        mono: true,
      })),
    ];
  });

  /** The spec's top-level settings as readable facts (`settings` mode). */
  readonly settingFacts = computed<FpcKeyValueItem[]>(() => {
    const r = this.resource();

    return r
      ? specFacts(r.kind, (r as { spec?: unknown }).spec, (count) =>
          fpcPlural(count, { one: this.entriesOne, other: this.entriesOther }, this.locale),
        )
      : [];
  });
  readonly title = $localize`:@@lwConsoleResourceDetail-title:Resource`;
  readonly settingsTitle = $localize`:@@lwConsoleResourceDetail-settings:Settings`;
  readonly noSettingsLabel = $localize`:@@lwConsoleResourceDetail-noSettings:No settings`;
  readonly entriesOne = $localize`:@@lwConsoleResourceDetail-entriesOne:{count} entry`;
  readonly entriesOther = $localize`:@@lwConsoleResourceDetail-entriesOther:{count} entries`;
  readonly metadataTitle = $localize`:@@lwConsoleResourceDetail-metadata:Metadata`;
  readonly yamlTab = $localize`:@@lwConsoleResourceDetail-yaml:YAML`;
  readonly composeTab = $localize`:@@lwConsoleResourceDetail-compose:Compose file`;
  readonly keepLabel = $localize`:@@lwConsoleResourceDetail-keep:Keep`;
  readonly viewLabel = $localize`:@@lwConsoleResourceDetail-view:View`;
  readonly loadingLabel = $localize`:@@lwConsoleResourceDetail-loading:Loading the resource`;

  ngOnInit(): void {
    combineLatest([this.keyInput$, this.route.paramMap, this.route.queryParamMap])
      .pipe(
        map(([input, params, query]) => input ?? routeResourceKey(params, query)),
        distinctUntilChanged((a, b) => !!a && !!b && sameResourceKey(a, b)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((key) => {
        this.key.set(key);

        if (key) this.facade.open(key);
      });
  }

  dismissPlanError(): void {
    this.facade.clearPlanError();
  }
}
