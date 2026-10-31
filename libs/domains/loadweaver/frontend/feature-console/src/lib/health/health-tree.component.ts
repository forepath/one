import { formatDate } from '@angular/common';
import { Component, LOCALE_ID, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { HealthTreeNode } from '@forepath/loadweaver/frontend/data-access-console';
import { FpcTreeComponent, type FpcTreeNode } from '@forepath/shared/frontend/ui-components';

import { HEALTH_TONE, healthLabel } from '../overview/console-format';
import { HEALTH_KIND_ICON, healthKindLabel, healthLink, healthReasonText } from './health-format';

/**
 * The explained health tree (cluster → site → node; project → deployment → service → replica) on the shared
 * `fpc-tree` (3.38): every entity with its state (status dot + label), kind, since when and the readable reasons in
 * the row hint; collapsible (first `expandDepth` levels open, explicit toggles win), keyboard navigable,
 * and Enter / click opens the entity's detail.
 */
@Component({
  selector: 'loadweaver-health-tree',
  imports: [FpcTreeComponent],
  standalone: true,
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0', 'data-testid': 'health-tree' },
  template: `
    <fpc-tree
      class="flex-grow-1"
      [nodes]="treeNodes()"
      [expanded]="expanded()"
      (expandedChange)="onExpandedChange($event)"
      [ariaLabel]="treeLabel"
      (nodeActivate)="open($event)"
    />
  `,
})
export class LoadweaverHealthTreeComponent {
  private readonly router = inject(Router);
  private readonly locale = inject(LOCALE_ID);

  readonly nodes = input<HealthTreeNode[]>([]);
  /** Levels expanded at first. */
  readonly expandDepth = input(2);

  /** Explicit toggles by key (otherwise `expandDepth` decides). */
  private readonly toggled = signal<ReadonlyMap<string, boolean>>(new Map());

  readonly treeLabel = $localize`:@@lwConsoleHealthTree-label:Health tree`;
  private readonly sinceLabel = $localize`:@@lwConsoleHealthTree-since:since`;

  readonly treeNodes = computed(() => this.nodes().map((node) => this.toTreeNode(node)));

  /** Open entities: an explicit toggle, else every level above `expandDepth`. */
  readonly expanded = computed(() => {
    const toggled = this.toggled();
    const depthOpen = this.expandDepth();
    const ids: string[] = [];
    const walk = (list: readonly HealthTreeNode[], depth: number): void => {
      for (const node of list) {
        if (node.children.length === 0) continue;
        if (toggled.get(node.entity.key) ?? depth < depthOpen) ids.push(node.entity.key);
        walk(node.children, depth + 1);
      }
    };

    walk(this.nodes(), 0);

    return ids;
  });

  onExpandedChange(next: readonly string[]): void {
    const before = new Set(this.expanded());
    const after = new Set(next);
    const toggled = new Map(this.toggled());

    for (const key of after) if (!before.has(key)) toggled.set(key, true);
    for (const key of before) if (!after.has(key)) toggled.set(key, false);
    this.toggled.set(toggled);
  }

  open(node: FpcTreeNode<HealthTreeNode>): void {
    if (node.data) void this.router.navigateByUrl(healthLink(node.data.entity.key));
  }

  private toTreeNode(node: HealthTreeNode): FpcTreeNode<HealthTreeNode> {
    const { entity } = node;
    const since = entity.since ? `${this.sinceLabel} ${formatDate(entity.since, 'short', this.locale)}` : null;
    // Translated causes, no `code: message` with raw instants (D7, LW-04).
    const reasons = [...new Set(entity.reasons.map((reason) => healthReasonText(reason, this.locale)))].join('; ');

    return {
      id: entity.key,
      label: entity.name,
      icon: HEALTH_KIND_ICON[entity.kind]?.replace(/^bi-/, ''),
      status: HEALTH_TONE[entity.state],
      statusLabel: healthLabel(entity.state),
      hint: [healthKindLabel(entity.kind), since, reasons].filter(Boolean).join(' · '),
      // No reason-count badge: a bare "1" on every row meant nothing (LW-04); the hint names the causes.
      children: node.children.map((child) => this.toTreeNode(child)),
      data: node,
    };
  }
}
