import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  composeOf,
  ConsoleResourcesFacade,
  type ResourceKey,
  resourceToYaml,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcCodeEditorComponent,
  FpcConfirmDialogComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSpinnerComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';
import { combineLatest, map } from 'rxjs';

import { LoadweaverAutoscalingPanelComponent } from '../autoscaling/autoscaling-panel.component';
import { healthLink } from '../health/health-format';
import { kindIcon, projectParams, resourceDescription, resourceEditLink, resourceLabel } from './resource-format';

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
 * deleting plans the deletion. Nothing is written without a plan.
 */
@Component({
  selector: 'loadweaver-resource-detail-page',
  imports: [
    CommonModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcCodeEditorComponent,
    FpcConfirmDialogComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcSpinnerComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    LoadweaverAutoscalingPanelComponent,
  ],
  templateUrl: './resource-detail-page.component.html',
  standalone: true,
})
export class LoadweaverResourceDetailPageComponent implements OnInit {
  private readonly facade = inject(ConsoleResourcesFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly resource = toSignal(this.facade.selected$, { initialValue: null });
  readonly loading = toSignal(this.facade.selectedLoading$, { initialValue: false });
  readonly error = toSignal(this.facade.selectedError$, { initialValue: null });
  readonly planning = toSignal(this.facade.planning$, { initialValue: false });
  readonly planError = toSignal(this.facade.planError$, { initialValue: null });

  readonly key = signal<ResourceKey | null>(null);
  readonly deleteOpen = signal(false);
  readonly activeTab = signal<string | null>('yaml');

  readonly yaml = computed(() => {
    const resource = this.resource();

    return resource ? resourceToYaml(resource) : '';
  });
  readonly compose = computed(() => (this.resource()?.kind === 'Deployment' ? composeOf(this.yaml()) : null));
  readonly description = computed(() => {
    const resource = this.resource();

    return resource ? resourceDescription(resource) : null;
  });
  /** Deployments have a health entry; policies and groups live on the map. */
  readonly healthUrl = computed(() => {
    const resource = this.resource();

    return resource?.kind === 'Deployment' && resource.metadata.project
      ? healthLink(`deployment/${resource.metadata.project}/${resource.metadata.name}`)
      : null;
  });
  readonly heading = computed(() => {
    const key = this.key();

    return key ? resourceLabel(key) : this.title;
  });
  readonly onMap = computed(() => ['Policy', 'WorkloadGroup'].includes(this.resource()?.kind ?? ''));

  readonly kindIcon = kindIcon;
  readonly editLink = resourceEditLink;
  readonly projectParams = projectParams;

  readonly title = $localize`:@@lwConsoleResourceDetail-title:Resource`;
  readonly backLabel = $localize`:@@lwConsoleResourceDetail-back:All resources`;
  readonly mapLabel = $localize`:@@lwConsoleResourceDetail-map:Map`;
  readonly healthLabel = $localize`:@@lwConsoleResourceDetail-health:Health`;
  readonly deleteLabel = $localize`:@@lwConsoleResourceDetail-delete:Delete`;
  readonly editLabel = $localize`:@@lwConsoleResourceDetail-edit:Edit`;
  readonly metadataTitle = $localize`:@@lwConsoleResourceDetail-metadata:Metadata`;
  readonly yamlTab = $localize`:@@lwConsoleResourceDetail-yaml:YAML`;
  readonly composeTab = $localize`:@@lwConsoleResourceDetail-compose:Compose file`;
  readonly deleteTitle = $localize`:@@lwConsoleResourceDetail-deleteTitle:Plan the deletion?`;
  readonly deleteMessage = $localize`:@@lwConsoleResourceDetail-deleteMessage:This creates a plan that deletes the resource. Nothing changes until the plan is reviewed and applied.`;
  readonly deleteConfirm = $localize`:@@lwConsoleResourceDetail-deleteConfirm:Plan deletion`;
  readonly keepLabel = $localize`:@@lwConsoleResourceDetail-keep:Keep`;

  ngOnInit(): void {
    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(
        map(([params, query]) => routeResourceKey(params, query)),
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

  /** Plans the deletion; the plan opens on success. */
  confirmDelete(): void {
    const key = this.key();

    if (!key) return;

    this.facade.plan({
      delete: [{ kind: key.kind, name: key.name, ...(key.project ? { project: key.project } : {}) }],
    });
  }
}
