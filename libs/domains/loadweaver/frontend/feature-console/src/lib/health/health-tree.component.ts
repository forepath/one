import { CommonModule } from '@angular/common';
import { Component, input, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import type { HealthTreeNode } from '@forepath/loadweaver/frontend/data-access-console';
import { FpcBadgeComponent, FpcStatusBadgeComponent } from '@forepath/shared/frontend/ui-components';

import { HEALTH_ICON, HEALTH_TONE, healthLabel } from '../overview/console-format';
import { HEALTH_KIND_ICON, healthKindLabel, healthLink } from './health-format';

/**
 * The explained health tree (cluster → site → node; project → deployment → service → replica): every entity with
 * its state, the machine-readable reasons and since when; collapsible, linking to the entity's detail.
 */
@Component({
  selector: 'loadweaver-health-tree',
  imports: [CommonModule, RouterModule, FpcBadgeComponent, FpcStatusBadgeComponent],
  templateUrl: './health-tree.component.html',
  standalone: true,
})
export class LoadweaverHealthTreeComponent {
  readonly nodes = input<HealthTreeNode[]>([]);
  /** Levels expanded at first. */
  readonly expandDepth = input(2);

  /** Explicit toggles by key (otherwise `expandDepth` decides). */
  private readonly toggled = signal<ReadonlyMap<string, boolean>>(new Map());

  readonly healthLabel = healthLabel;
  readonly kindLabel = healthKindLabel;
  readonly link = healthLink;

  readonly expandLabel = $localize`:@@lwConsoleHealthTree-expand:Expand`;
  readonly collapseLabel = $localize`:@@lwConsoleHealthTree-collapse:Collapse`;

  toneOf(node: HealthTreeNode) {
    return HEALTH_TONE[node.entity.state];
  }

  iconOf(node: HealthTreeNode): string {
    return HEALTH_ICON[node.entity.state];
  }

  kindIconOf(node: HealthTreeNode): string {
    return HEALTH_KIND_ICON[node.entity.kind];
  }

  isOpen(node: HealthTreeNode, depth: number): boolean {
    return this.toggled().get(node.entity.key) ?? depth < this.expandDepth();
  }

  toggle(node: HealthTreeNode, depth: number): void {
    const next = new Map(this.toggled());

    next.set(node.entity.key, !this.isOpen(node, depth));
    this.toggled.set(next);
  }
}
