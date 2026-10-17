import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal, viewChildren } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleLiveFacade,
  isReplicaId,
  newTerminalSessionId,
  TerminalSocketClient,
  type LiveReplicaTarget,
  type TerminalSocketEvent,
  type TerminalTarget,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
  FpcTerminalComponent,
  type FpcTerminalSize,
} from '@forepath/shared/frontend/ui-components';

import { replicaGroups, replicaLabel } from '../live/live-format';

const NODE_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const SHELL = /^\/[A-Za-z0-9_./-]{1,64}$/;
/** The size a terminal starts with before its tab has measured itself. */
const DEFAULT_SIZE: FpcTerminalSize = { cols: 120, rows: 32 };

export type TerminalTabStatus = 'connecting' | 'open' | 'closed' | 'failed';

export interface TerminalTab {
  /** The session id on the socket. */
  id: string;
  label: string;
  target: TerminalTarget;
  status: TerminalTabStatus;
  recorded: boolean;
  exitCode: number | null;
  error: string | null;
}

/**
 * Terminals (3.19): pick a replica (project → deployment/service → replica) or, for cluster admins while the cluster
 * enables it, a node shell, and work in several tabs over `socket/terminals`. Sessions are audited; recorded ones show
 * a banner. `?replica=<project/deployment/service/index>` (from the map) opens one right away.
 */
@Component({
  selector: 'loadweaver-terminals-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcTerminalComponent,
  ],
  providers: [TerminalSocketClient],
  templateUrl: './terminals-page.component.html',
  standalone: true,
})
export class LoadweaverTerminalsPageComponent implements OnInit {
  private readonly live = inject(ConsoleLiveFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly client = inject(TerminalSocketClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly terminals = viewChildren(FpcTerminalComponent);
  /** Output that arrived before a tab's terminal existed. */
  private readonly pending = new Map<string, string[]>();
  /** The last size each tab measured and the size the server knows. */
  private readonly sizes = new Map<string, FpcTerminalSize>();
  private readonly sentSizes = new Map<string, string>();
  private destroyed = false;

  readonly replicas = toSignal(this.live.replicas$, { initialValue: [] as LiveReplicaTarget[] });
  readonly nodes = toSignal(this.live.nodes$, { initialValue: [] as string[] });
  readonly projects = toSignal(this.live.projects$, { initialValue: [] as string[] });
  readonly targetsLoading = toSignal(this.live.targetsLoading$, { initialValue: false });
  readonly targetsError = toSignal(this.live.targetsError$, { initialValue: null });
  readonly isClusterAdmin = toSignal(this.access.isClusterAdmin$, { initialValue: false });

  readonly mode = signal<'replica' | 'node'>('replica');
  readonly project = signal('');
  readonly replica = signal('');
  readonly node = signal('');
  readonly shell = signal('');
  readonly tabs = signal<TerminalTab[]>([]);
  readonly active = signal<string | null>(null);
  readonly connectionError = signal<string | null>(null);
  readonly socketError = signal<string | null>(null);
  /** A node shell from a deep link (`?node=`): opened only after the user confirms it. */
  readonly pendingNode = signal<string | null>(null);

  readonly groups = computed(() => replicaGroups(this.replicas(), this.project() || null));
  readonly activeTab = computed(() => this.tabs().find((tab) => tab.id === this.active()) ?? null);
  readonly canOpen = computed(() =>
    this.mode() === 'node'
      ? NODE_NAME.test(this.node()) && this.shellValid()
      : isReplicaId(this.replica()) && this.shellValid(),
  );
  readonly shellValid = computed(() => !this.shell().trim() || SHELL.test(this.shell().trim()));
  readonly openCount = computed(
    () => this.tabs().filter((t) => t.status === 'open' || t.status === 'connecting').length,
  );

  readonly replicaLabel = replicaLabel;

  readonly title = $localize`:@@lwConsoleTerminals-title:Terminals`;
  readonly openLabel = $localize`:@@lwConsoleTerminals-open:Open terminal`;
  readonly projectLabel = $localize`:@@lwConsoleTerminals-project:Project`;
  readonly replicaFieldLabel = $localize`:@@lwConsoleTerminals-replica:Replica`;
  readonly nodeLabel = $localize`:@@lwConsoleTerminals-node:Node`;
  readonly shellLabel = $localize`:@@lwConsoleTerminals-shell:Shell (optional, e.g. /bin/ash)`;
  readonly closeTabLabel = $localize`:@@lwConsoleTerminals-closeTab:Close terminal`;
  readonly reloadLabel = $localize`:@@lwConsoleTerminals-reload:Reload replicas`;
  readonly nodeConfirmTitle = $localize`:@@lwConsoleTerminals-nodeConfirmTitle:Open a root shell on this node?`;
  readonly nodeConfirmLabel = $localize`:@@lwConsoleTerminals-nodeConfirmOpen:Open node shell`;
  readonly cancelLabel = $localize`:@@lwConsoleTerminals-cancel:Cancel`;

  constructor() {
    this.client.events$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => this.onEvent(event));
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;

      for (const tab of this.tabs())
        if (tab.status === 'open' || tab.status === 'connecting') this.client.close(tab.id);
    });
  }

  ngOnInit(): void {
    this.live.loadTargets();

    const params = this.route.snapshot.queryParamMap;
    const replica = params.get('replica');
    const node = params.get('node');

    if (isReplicaId(replica)) {
      this.project.set(replica.split('/')[0]);
      this.replica.set(replica);
      void this.openTerminal({ replica });
    } else if (node && NODE_NAME.test(node)) {
      // A link must not open a root shell on its own: the user confirms it first.
      this.mode.set('node');
      this.node.set(node);
      this.pendingNode.set(node);
    }
  }

  nodeConfirmMessage(): string {
    const node = this.pendingNode() ?? '';

    return $localize`:@@lwConsoleTerminals-nodeConfirmMessage:A link asks to open a shell with root rights on node ${node}:node:. The session is audited. Only continue if you meant to open it.`;
  }

  confirmPendingNode(): void {
    const node = this.pendingNode();

    this.pendingNode.set(null);

    if (node) void this.openTerminal({ node });
  }

  onPendingNodeOpenChange(open: boolean): void {
    if (!open) this.pendingNode.set(null);
  }

  reloadTargets(): void {
    this.live.loadTargets();
  }

  onProjectChange(project: string): void {
    this.project.set(project);

    if (this.replica() && !this.replica().startsWith(`${project}/`)) this.replica.set('');
  }

  /** Opens a terminal for the picker's selection. */
  open(): void {
    if (!this.canOpen()) return;

    void this.openTerminal(this.mode() === 'node' ? { node: this.node() } : { replica: this.replica() });
  }

  async openTerminal(target: TerminalTarget): Promise<void> {
    const id = newTerminalSessionId();
    const label = 'node' in target ? `node/${target.node}` : target.replica;
    const shell = this.shell().trim();

    this.tabs.update((tabs) => [
      ...tabs,
      { id, label, target, status: 'connecting', recorded: false, exitCode: null, error: null },
    ]);
    this.active.set(id);
    this.syncUrl(target);

    const connected = await this.client.connect();

    // The page went away (or the tab was closed) while connecting: no session for it.
    if (this.destroyed || !this.tabs().some((tab) => tab.id === id)) return;

    if (!connected) {
      this.patch(id, { status: 'failed', error: this.connectionError() ?? 'No terminal connection' });

      return;
    }

    const size = this.lastSize();

    this.sentSizes.set(id, `${size.cols}x${size.rows}`);
    this.client.create({ sessionId: id, target, ...(shell && SHELL.test(shell) ? { shell } : {}), ...size });
  }

  select(tab: TerminalTab): void {
    this.active.set(tab.id);
    this.syncUrl(tab.target);
    queueMicrotask(() => this.terminalFor(tab.id)?.focus());
  }

  /** Ends the session (if it runs) and removes the tab. */
  closeTab(tab: TerminalTab): void {
    if (tab.status === 'open' || tab.status === 'connecting') this.client.close(tab.id);

    const tabs = this.tabs();
    const index = tabs.findIndex((t) => t.id === tab.id);
    const rest = tabs.filter((t) => t.id !== tab.id);

    this.tabs.set(rest);
    this.pending.delete(tab.id);
    this.sizes.delete(tab.id);
    this.sentSizes.delete(tab.id);

    if (this.active() === tab.id) this.active.set(rest[Math.min(index, rest.length - 1)]?.id ?? null);
  }

  /** Opens a new session for the same target. */
  reopen(tab: TerminalTab): void {
    this.closeTab(tab);
    void this.openTerminal(tab.target);
  }

  onInput(tab: TerminalTab, data: string): void {
    if (tab.status === 'open') this.client.input(tab.id, data);
  }

  onResize(tab: TerminalTab, size: FpcTerminalSize): void {
    this.sizes.set(tab.id, size);
    this.flush(tab.id);

    if (tab.status === 'open') this.sendSize(tab.id);
  }

  private onEvent(event: TerminalSocketEvent): void {
    switch (event.type) {
      case 'connection':
        if (event.connected) {
          this.connectionError.set(null);
        } else {
          if (event.error) this.connectionError.set(event.error);

          // Sessions belong to the socket: a disconnect ends them on the server.
          this.tabs.update((tabs) =>
            tabs.map((tab) =>
              tab.status === 'open' || tab.status === 'connecting'
                ? {
                    ...tab,
                    status: 'closed',
                    error: event.error ?? $localize`:@@lwConsoleTerminals-disconnected:Disconnected`,
                  }
                : tab,
            ),
          );
        }

        break;
      case 'created':
        this.patch(event.sessionId, { status: 'open', recorded: event.recorded });
        this.sendSize(event.sessionId);
        this.terminalFor(event.sessionId)?.focus();
        break;
      case 'output':
        this.write(event.sessionId, event.data);
        break;
      case 'closed':
        this.patch(event.sessionId, {
          status: 'closed',
          exitCode: event.exitCode,
          error: event.error ?? null,
        });
        break;
      case 'error': {
        const tab = event.sessionId ? this.tabs().find((t) => t.id === event.sessionId) : undefined;

        if (tab?.status === 'connecting') this.patch(tab.id, { status: 'failed', error: event.message });
        else if (tab) this.patch(tab.id, { error: event.message });
        else this.socketError.set(event.message);

        break;
      }
    }
  }

  private patch(id: string, changes: Partial<TerminalTab>): void {
    this.tabs.update((tabs) => tabs.map((tab) => (tab.id === id ? { ...tab, ...changes } : tab)));
  }

  private terminalFor(id: string): FpcTerminalComponent | undefined {
    const index = this.tabs().findIndex((tab) => tab.id === id);

    return index >= 0 ? this.terminals()[index] : undefined;
  }

  private write(id: string, data: string): void {
    const terminal = this.terminalFor(id);

    if (terminal) terminal.write(data);
    else this.pending.set(id, [...(this.pending.get(id) ?? []), data]);
  }

  private flush(id: string): void {
    const queued = this.pending.get(id);
    const terminal = this.terminalFor(id);

    if (!queued || !terminal) return;

    this.pending.delete(id);

    for (const data of queued) terminal.write(data);
  }

  private sendSize(id: string): void {
    const size = this.sizes.get(id);

    if (!size) return;

    const key = `${size.cols}x${size.rows}`;

    if (this.sentSizes.get(id) === key) return;

    this.sentSizes.set(id, key);
    this.client.resize(id, size.cols, size.rows);
  }

  private lastSize(): FpcTerminalSize {
    return [...this.sizes.values()].at(-1) ?? DEFAULT_SIZE;
  }

  private syncUrl(target: TerminalTarget): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParams: 'node' in target ? { node: target.node, replica: null } : { replica: target.replica, node: null },
    });
  }
}
