import { CommonModule } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { RouterModule } from '@angular/router';
import {
  gitCommitUrl,
  gitPullRequestUrl,
  shortRef,
  shortSha,
  type GitConnection,
  type Plan,
} from '@forepath/loadweaver/frontend/data-access-console';
import { FpcBadgeComponent } from '@forepath/shared/frontend/ui-components';

import { PLAN_SOURCE_ICON, planSourceLabel } from '../git/git-format';
import { safeExternalUrl } from './plan-format';

/**
 * Where a plan came from (3.29): a badge (Git / console / API / drift / system) and, for Git plans, the commit with
 * its ref, pull request and author, linked to the provider where the connection is readable; the plan it supersedes
 * or that superseded it, a plan bot plan's limit and that the change's Git authors can't approve it. `compact` for
 * lists.
 */
@Component({
  selector: 'loadweaver-plan-source',
  imports: [CommonModule, RouterModule, FpcBadgeComponent],
  templateUrl: './plan-source.component.html',
  standalone: true,
})
export class LoadweaverPlanSourceComponent {
  readonly plan = input.required<Plan>();
  readonly connections = input<readonly GitConnection[]>([]);
  readonly compact = input(false);

  readonly source = computed(() => this.plan().source ?? null);
  readonly connection = computed(() => {
    const id = this.source()?.connection;

    return id ? (this.connections().find((c) => c.id === id) ?? null) : null;
  });
  readonly commitUrl = computed(() => {
    const connection = this.connection();
    const commit = this.source()?.commit;

    return connection && commit ? gitCommitUrl(connection, commit) : null;
  });
  /** The URL the plan bot recorded, otherwise derived from the readable connection. */
  readonly prUrl = computed(() => {
    const source = this.source();
    const recorded = safeExternalUrl(source?.prUrl);

    if (recorded) return recorded;

    const connection = this.connection();

    return connection && source?.pr ? gitPullRequestUrl(connection, source.pr) : null;
  });

  readonly icon = PLAN_SOURCE_ICON;
  readonly label = planSourceLabel;
  readonly shortSha = shortSha;
  readonly shortRef = shortRef;
  readonly shortId = (id: string) => id.slice(0, 8);
}
