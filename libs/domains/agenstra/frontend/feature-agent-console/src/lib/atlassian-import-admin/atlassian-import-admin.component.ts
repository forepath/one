import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  AtlassianContextImportFacade,
  clearExternalImportMarkersSuccess,
  ClientsFacade,
  createAtlassianConnectionSuccess,
  createExternalImportConfigSuccess,
  deleteAtlassianConnectionSuccess,
  deleteExternalImportConfigSuccess,
  KnowledgeFacade,
  TicketsFacade,
  updateAtlassianConnectionSuccess,
  updateExternalImportConfigSuccess,
  type AtlassianSiteConnectionDto,
  type ClientResponseDto,
  type CreateAtlassianSiteConnectionDto,
  type CreateExternalImportConfigDto,
  type ExternalImportConfigDto,
  type ExternalImportKind,
  type KnowledgeNodeDto,
  type TicketResponseDto,
  type TicketStatus,
  type UpdateAtlassianSiteConnectionDto,
  type UpdateExternalImportConfigDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { Actions, ofType } from '@ngrx/effects';

import { DEFAULT_ATLASSIAN_CONFLUENCE_CQL, DEFAULT_ATLASSIAN_JIRA_JQL } from './atlassian-import-defaults';
import {
  filterKnowledgeFoldersForImportSuggest,
  filterTicketsForImportParentSuggest,
  flattenKnowledgeFolders,
} from './atlassian-import-parent-suggest.utils';
import { buildConfluenceImportSearchCql } from './confluence-import-search-cql.util';

export type AtlassianImportAdminLane = 'connections' | 'configs';

@Component({
  selector: 'framework-atlassian-import-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './atlassian-import-admin.component.html',
  styleUrl: './atlassian-import-admin.component.scss',
})
export class AtlassianImportAdminComponent implements OnInit {
  @ViewChild('editConnectionModal', { static: false })
  private editConnectionModal!: ElementRef<HTMLDivElement>;

  @ViewChild('editConfigModal', { static: false })
  private editConfigModal!: ElementRef<HTMLDivElement>;

  @ViewChild('deleteConnectionModal', { static: false })
  private deleteConnectionModal!: ElementRef<HTMLDivElement>;

  @ViewChild('deleteConfigModal', { static: false })
  private deleteConfigModal!: ElementRef<HTMLDivElement>;

  @ViewChild('clearMarkersModal', { static: false })
  private clearMarkersModal!: ElementRef<HTMLDivElement>;

  @ViewChild('createConnectionModal', { static: false })
  private createConnectionModal!: ElementRef<HTMLDivElement>;

  @ViewChild('createConfigModal', { static: false })
  private createConfigModal!: ElementRef<HTMLDivElement>;

  private readonly facade = inject(AtlassianContextImportFacade);
  private readonly clientsFacade = inject(ClientsFacade);
  private readonly ticketsFacade = inject(TicketsFacade);
  private readonly knowledgeFacade = inject(KnowledgeFacade);
  private readonly actions$ = inject(Actions);
  private readonly destroyRef = inject(DestroyRef);

  readonly connections = toSignal(this.facade.connections$, { initialValue: [] as AtlassianSiteConnectionDto[] });
  readonly configs = toSignal(this.facade.configs$, { initialValue: [] as ExternalImportConfigDto[] });
  readonly clients = toSignal(this.clientsFacade.clients$, { initialValue: [] as ClientResponseDto[] });
  readonly tickets = toSignal(this.ticketsFacade.tickets$, { initialValue: [] as TicketResponseDto[] });
  readonly knowledgeTree = toSignal(this.knowledgeFacade.tree$, { initialValue: [] as KnowledgeNodeDto[] });
  readonly loading$ = this.facade.loading$;
  readonly error$ = this.facade.error$;
  readonly saving$ = this.facade.saving$;
  readonly deleting$ = this.facade.deleting$;
  readonly runningConfigId$ = this.facade.runningConfigId$;
  readonly testingConnectionId$ = this.facade.testingConnectionId$;
  readonly clearingMarkersId$ = this.facade.clearingMarkersId$;
  readonly lastConnectionTest$ = this.facade.lastConnectionTest$;

  readonly adminLanes: AtlassianImportAdminLane[] = ['connections', 'configs'];
  readonly selectedLane = signal<AtlassianImportAdminLane>('connections');

  connectionsSearchQuery = '';
  configsSearchQuery = '';

  readonly jiraSwimlaneOptions: { value: TicketStatus; label: string }[] = [
    { value: 'draft', label: $localize`:@@featureAtlassianImportAdmin-swimlaneDraft:Draft` },
    { value: 'todo', label: $localize`:@@featureAtlassianImportAdmin-swimlaneTodo:To do` },
    { value: 'in_progress', label: $localize`:@@featureAtlassianImportAdmin-swimlaneInProgress:In progress` },
    { value: 'prototype', label: $localize`:@@featureAtlassianImportAdmin-swimlanePrototype:Prototype` },
    { value: 'done', label: $localize`:@@featureAtlassianImportAdmin-swimlaneDone:Done` },
    { value: 'closed', label: $localize`:@@featureAtlassianImportAdmin-swimlaneClosed:Closed` },
  ];

  newConnection: CreateAtlassianSiteConnectionDto = {
    baseUrl: '',
    accountEmail: '',
    apiToken: '',
  };

  connectionToEdit: AtlassianSiteConnectionDto | null = null;
  editConnection: UpdateAtlassianSiteConnectionDto & { apiToken?: string } = {};

  newConfig: CreateExternalImportConfigDto = {
    provider: 'atlassian',
    importKind: 'jira',
    atlassianConnectionId: '',
    clientId: '',
    enabled: true,
    jiraBoardId: null,
    jql: DEFAULT_ATLASSIAN_JIRA_JQL,
    importTargetTicketStatus: 'draft',
    confluenceSpaceKey: null,
    confluenceRootPageId: null,
    cql: DEFAULT_ATLASSIAN_CONFLUENCE_CQL,
    agenstraParentTicketId: null,
    agenstraParentFolderId: null,
  };

  newConfigJiraBoardIdText = '';
  newParentTicketSearch = '';
  newParentFolderSearch = '';
  newParentTicketSuggestOpen = false;
  newParentFolderSuggestOpen = false;

  configToEdit: ExternalImportConfigDto | null = null;
  editConfig: UpdateExternalImportConfigDto = {};
  editConfigJiraBoardIdText = '';
  editParentTicketSearch = '';
  editParentFolderSearch = '';
  editParentTicketSuggestOpen = false;
  editParentFolderSuggestOpen = false;

  connectionPendingDelete: AtlassianSiteConnectionDto | null = null;
  configPendingDelete: ExternalImportConfigDto | null = null;
  configPendingClearMarkers: ExternalImportConfigDto | null = null;

  refresh(): void {
    this.facade.load();
  }

  connectionNameForConfig(cfg: ExternalImportConfigDto): string {
    const c = this.connections().find((x) => x.id === cfg.atlassianConnectionId);

    return c ? this.connectionLabel(c) : cfg.atlassianConnectionId;
  }

  filteredConnections(): AtlassianSiteConnectionDto[] {
    const q = this.connectionsSearchQuery.trim().toLowerCase();
    const list = this.connections();

    if (!q) {
      return list;
    }

    return list.filter((c) => this.connectionSearchHaystack(c).includes(q));
  }

  filteredConfigs(): ExternalImportConfigDto[] {
    const q = this.configsSearchQuery.trim().toLowerCase();
    const list = this.configs();

    if (!q) {
      return list;
    }

    return list.filter((cfg) => this.configSearchHaystack(cfg).includes(q));
  }

  jiraImportTargetLabel(status: TicketStatus | null | undefined): string {
    return this.jiraSwimlaneOptions.find((o) => o.value === status)?.label ?? status ?? '';
  }

  ngOnInit(): void {
    this.facade.load();
    this.clientsFacade.loadClients({ limit: 500, offset: 0 });

    this.actions$
      .pipe(
        ofType(
          createAtlassianConnectionSuccess,
          updateAtlassianConnectionSuccess,
          createExternalImportConfigSuccess,
          updateExternalImportConfigSuccess,
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.hideModal(this.createConnectionModal);
        this.hideModal(this.createConfigModal);
        this.hideModal(this.editConnectionModal);
        this.hideModal(this.editConfigModal);
        this.resetNewConnection();
        this.resetNewConfig();
      });

    this.actions$
      .pipe(ofType(deleteAtlassianConnectionSuccess), takeUntilDestroyed(this.destroyRef))
      .subscribe(({ id }) => {
        this.connectionToEdit = null;

        if (this.connectionPendingDelete?.id === id) {
          this.hideModal(this.deleteConnectionModal);
        }
      });

    this.actions$
      .pipe(ofType(deleteExternalImportConfigSuccess), takeUntilDestroyed(this.destroyRef))
      .subscribe(({ id }) => {
        this.configToEdit = null;

        if (this.configPendingDelete?.id === id) {
          this.hideModal(this.deleteConfigModal);
        }
      });

    this.actions$
      .pipe(ofType(clearExternalImportMarkersSuccess), takeUntilDestroyed(this.destroyRef))
      .subscribe(({ id }) => {
        if (this.configPendingClearMarkers?.id === id) {
          this.hideModal(this.clearMarkersModal);
        }
      });
  }

  clientName(id: string): string {
    return this.clients().find((c) => c.id === id)?.name ?? id;
  }

  adminLaneLabel(lane: AtlassianImportAdminLane): string {
    switch (lane) {
      case 'connections':
        return $localize`:@@featureAtlassianImportAdmin-laneConnections:Site connections`;
      case 'configs':
        return $localize`:@@featureAtlassianImportAdmin-laneConfigs:Import configs`;
    }
  }

  unnamedConnectionLabel(): string {
    return $localize`:@@featureAtlassianImportAdmin-unnamedConnection:Unnamed connection`;
  }

  emptyFieldMarker(): string {
    return $localize`:@@featureAtlassianImportAdmin-emptyField:—`;
  }

  connectionLabel(c: AtlassianSiteConnectionDto): string {
    const label = c.label?.trim();

    if (label) {
      return label;
    }

    return this.hostnameFromBaseUrl(c.baseUrl);
  }

  connectionHostname(c: AtlassianSiteConnectionDto): string {
    return this.hostnameFromBaseUrl(c.baseUrl);
  }

  /** Effective CQL sent to Confluence (same composition as backend `buildConfluenceImportSearchCql`). */
  displayConfluenceSearchCql(cfg: ExternalImportConfigDto): string {
    if (cfg.importKind !== 'confluence') {
      return '';
    }

    const built = buildConfluenceImportSearchCql(cfg.cql ?? '', cfg.confluenceSpaceKey, cfg.confluenceRootPageId);

    return built.trim() ? built : this.emptyFieldMarker();
  }

  onClearError(): void {
    this.facade.clearError();
  }

  onClearTestResult(): void {
    this.facade.clearTestResult();
  }

  resetNewConnection(): void {
    this.newConnection = { baseUrl: '', accountEmail: '', apiToken: '' };
  }

  openCreateConnectionModal(): void {
    this.resetNewConnection();
    setTimeout(() => this.showModal(this.createConnectionModal));
  }

  onCloseCreateConnectionModal(): void {
    this.hideModal(this.createConnectionModal);
  }

  onCreateConnectionModalHidden(): void {
    this.resetNewConnection();
  }

  openCreateConfigModal(): void {
    this.resetNewConfig();
    setTimeout(() => this.showModal(this.createConfigModal));
  }

  onCloseCreateConfigModal(): void {
    this.hideModal(this.createConfigModal);
  }

  onCreateConfigModalHidden(): void {
    this.resetNewConfig();
  }

  submitNewConnection(): void {
    const dto: CreateAtlassianSiteConnectionDto = {
      ...this.newConnection,
      label: this.newConnection.label?.trim() || undefined,
    };

    if (!dto.baseUrl.trim() || !dto.accountEmail.trim() || !dto.apiToken.trim()) {
      return;
    }

    this.facade.createConnection(dto);
  }

  openEditConnection(c: AtlassianSiteConnectionDto): void {
    this.connectionToEdit = c;
    this.editConnection = {
      label: c.label ?? '',
      baseUrl: c.baseUrl,
      accountEmail: c.accountEmail,
      apiToken: '',
    };
    setTimeout(() => this.showModal(this.editConnectionModal));
  }

  onEditConnectionModalHidden(): void {
    this.connectionToEdit = null;
  }

  submitEditConnection(): void {
    if (!this.connectionToEdit) return;

    const dto: UpdateAtlassianSiteConnectionDto = {
      label: this.editConnection.label,
      baseUrl: this.editConnection.baseUrl,
      accountEmail: this.editConnection.accountEmail,
    };

    if (this.editConnection.apiToken?.trim()) {
      dto.apiToken = this.editConnection.apiToken.trim();
    }

    this.facade.updateConnection(this.connectionToEdit.id, dto);
  }

  openDeleteConnectionConfirm(c: AtlassianSiteConnectionDto): void {
    this.connectionPendingDelete = c;
    setTimeout(() => this.showModal(this.deleteConnectionModal));
  }

  onDeleteConnectionModalHidden(): void {
    this.connectionPendingDelete = null;
  }

  executeDeleteConnection(): void {
    const c = this.connectionPendingDelete;

    if (!c) {
      return;
    }

    this.facade.deleteConnection(c.id);
  }

  openDeleteConfigConfirm(c: ExternalImportConfigDto): void {
    this.configPendingDelete = c;
    setTimeout(() => this.showModal(this.deleteConfigModal));
  }

  onDeleteConfigModalHidden(): void {
    this.configPendingDelete = null;
  }

  executeDeleteConfig(): void {
    const c = this.configPendingDelete;

    if (!c) {
      return;
    }

    this.facade.deleteConfig(c.id);
  }

  openClearMarkersConfirm(c: ExternalImportConfigDto): void {
    this.configPendingClearMarkers = c;
    setTimeout(() => this.showModal(this.clearMarkersModal));
  }

  onClearMarkersModalHidden(): void {
    this.configPendingClearMarkers = null;
  }

  executeClearMarkers(): void {
    const c = this.configPendingClearMarkers;

    if (!c) {
      return;
    }

    this.facade.clearMarkers(c.id);
  }

  testConnection(id: string): void {
    this.facade.clearTestResult();
    this.facade.testConnection(id);
  }

  onWorkspaceDataLoad(clientId: string): void {
    const id = clientId?.trim();

    if (!id) {
      return;
    }

    this.ticketsFacade.loadTickets({ clientId: id });
    this.knowledgeFacade.loadTree(id);
  }

  resetNewConfig(): void {
    this.newConfigJiraBoardIdText = '';
    this.newParentTicketSearch = '';
    this.newParentFolderSearch = '';
    this.newParentTicketSuggestOpen = false;
    this.newParentFolderSuggestOpen = false;
    this.newConfig = {
      provider: 'atlassian',
      importKind: 'jira',
      atlassianConnectionId: '',
      clientId: '',
      enabled: true,
      jiraBoardId: null,
      jql: DEFAULT_ATLASSIAN_JIRA_JQL,
      importTargetTicketStatus: 'draft',
      confluenceSpaceKey: null,
      confluenceRootPageId: null,
      cql: DEFAULT_ATLASSIAN_CONFLUENCE_CQL,
      agenstraParentTicketId: null,
      agenstraParentFolderId: null,
    };
  }

  onNewConfigKindChange(kind: ExternalImportKind): void {
    this.newConfig.importKind = kind;
    this.newConfig.jiraBoardId = null;
    this.newConfig.jql = kind === 'jira' ? DEFAULT_ATLASSIAN_JIRA_JQL : null;
    this.newConfig.importTargetTicketStatus = kind === 'jira' ? 'draft' : undefined;
    this.newConfig.confluenceSpaceKey = null;
    this.newConfig.confluenceRootPageId = null;
    this.newConfig.cql = kind === 'confluence' ? DEFAULT_ATLASSIAN_CONFLUENCE_CQL : null;
    this.newConfig.agenstraParentTicketId = null;
    this.newConfig.agenstraParentFolderId = null;
    this.newConfigJiraBoardIdText = '';
    this.newParentTicketSearch = '';
    this.newParentFolderSearch = '';
  }

  newKnowledgeFoldersFlat(): KnowledgeNodeDto[] {
    return flattenKnowledgeFolders(this.knowledgeTree());
  }

  editKnowledgeFoldersFlat(): KnowledgeNodeDto[] {
    return flattenKnowledgeFolders(this.knowledgeTree());
  }

  newParentTicketSuggestions(): TicketResponseDto[] {
    return filterTicketsForImportParentSuggest(this.tickets(), this.newConfig.clientId, this.newParentTicketSearch);
  }

  editParentTicketSuggestions(): TicketResponseDto[] {
    const clientId = this.editConfig.clientId ?? '';

    return filterTicketsForImportParentSuggest(this.tickets(), clientId, this.editParentTicketSearch);
  }

  newParentFolderSuggestions(): KnowledgeNodeDto[] {
    return filterKnowledgeFoldersForImportSuggest(this.newKnowledgeFoldersFlat(), this.newParentFolderSearch);
  }

  editParentFolderSuggestions(): KnowledgeNodeDto[] {
    return filterKnowledgeFoldersForImportSuggest(this.editKnowledgeFoldersFlat(), this.editParentFolderSearch);
  }

  formatTicketPick(t: TicketResponseDto): string {
    const short = t.shas?.short ?? t.id.slice(0, 8);

    return $localize`:@@featureAtlassianImportAdmin-ticketPick:${t.title}:title: · ${short}:sha:`;
  }

  formatFolderPick(n: KnowledgeNodeDto): string {
    return $localize`:@@featureAtlassianImportAdmin-folderPick:${n.title}:title: · ${n.shas.short}:sha:`;
  }

  onPickNewParentTicket(t: TicketResponseDto, event: Event): void {
    event.preventDefault();
    this.newConfig.agenstraParentTicketId = t.id;
    this.newParentTicketSearch = this.formatTicketPick(t);
    this.newParentTicketSuggestOpen = false;
  }

  onPickEditParentTicket(t: TicketResponseDto, event: Event): void {
    event.preventDefault();
    this.editConfig.agenstraParentTicketId = t.id;
    this.editParentTicketSearch = this.formatTicketPick(t);
    this.editParentTicketSuggestOpen = false;
  }

  onPickNewParentFolder(n: KnowledgeNodeDto, event: Event): void {
    event.preventDefault();
    this.newConfig.agenstraParentFolderId = n.id;
    this.newParentFolderSearch = this.formatFolderPick(n);
    this.newParentFolderSuggestOpen = false;
  }

  onPickEditParentFolder(n: KnowledgeNodeDto, event: Event): void {
    event.preventDefault();
    this.editConfig.agenstraParentFolderId = n.id;
    this.editParentFolderSearch = this.formatFolderPick(n);
    this.editParentFolderSuggestOpen = false;
  }

  clearNewParentTicket(): void {
    this.newConfig.agenstraParentTicketId = null;
    this.newParentTicketSearch = '';
  }

  clearEditParentTicket(): void {
    this.editConfig.agenstraParentTicketId = null;
    this.editParentTicketSearch = '';
  }

  clearNewParentFolder(): void {
    this.newConfig.agenstraParentFolderId = null;
    this.newParentFolderSearch = '';
  }

  clearEditParentFolder(): void {
    this.editConfig.agenstraParentFolderId = null;
    this.editParentFolderSearch = '';
  }

  onNewParentTicketInput(value: string): void {
    this.newParentTicketSearch = value;
    this.newParentTicketSuggestOpen = true;
  }

  onEditParentTicketInput(value: string): void {
    this.editParentTicketSearch = value;
    this.editParentTicketSuggestOpen = true;
  }

  onNewParentFolderInput(value: string): void {
    this.newParentFolderSearch = value;
    this.newParentFolderSuggestOpen = true;
  }

  onEditParentFolderInput(value: string): void {
    this.editParentFolderSearch = value;
    this.editParentFolderSuggestOpen = true;
  }

  onNewParentTicketBlur(): void {
    setTimeout(() => {
      this.newParentTicketSuggestOpen = false;
    }, 180);
  }

  onEditParentTicketBlur(): void {
    setTimeout(() => {
      this.editParentTicketSuggestOpen = false;
    }, 180);
  }

  onNewParentFolderBlur(): void {
    setTimeout(() => {
      this.newParentFolderSuggestOpen = false;
    }, 180);
  }

  onEditParentFolderBlur(): void {
    setTimeout(() => {
      this.editParentFolderSuggestOpen = false;
    }, 180);
  }

  onNewParentTicketFocus(): void {
    if (this.newConfig.clientId && this.newParentTicketSuggestions().length > 0) {
      this.newParentTicketSuggestOpen = true;
    }
  }

  onEditParentTicketFocus(): void {
    const clientId = this.editConfig.clientId ?? '';

    if (clientId && this.editParentTicketSuggestions().length > 0) {
      this.editParentTicketSuggestOpen = true;
    }
  }

  onNewParentFolderFocus(): void {
    this.newParentFolderSuggestOpen = true;
  }

  onEditParentFolderFocus(): void {
    this.editParentFolderSuggestOpen = true;
  }

  private parseBoardId(text: string): number | null {
    const t = text.trim();

    if (!t) return null;

    const n = Number.parseInt(t, 10);

    return Number.isFinite(n) && n > 0 ? n : null;
  }

  submitNewConfig(): void {
    if (!this.newConfig.atlassianConnectionId || !this.newConfig.clientId) {
      return;
    }

    if (this.newConfig.importKind === 'jira' && !this.newConfig.jql?.trim()) {
      return;
    }

    if (this.newConfig.importKind === 'confluence' && !this.newConfig.cql?.trim()) {
      return;
    }

    const dto: CreateExternalImportConfigDto = {
      provider: 'atlassian',
      importKind: this.newConfig.importKind,
      atlassianConnectionId: this.newConfig.atlassianConnectionId,
      clientId: this.newConfig.clientId,
      enabled: this.newConfig.enabled !== false,
    };

    if (this.newConfig.importKind === 'jira') {
      dto.jiraBoardId = this.parseBoardId(this.newConfigJiraBoardIdText);
      dto.jql = this.newConfig.jql?.trim() || null;
      dto.importTargetTicketStatus = this.newConfig.importTargetTicketStatus ?? 'draft';
      dto.agenstraParentTicketId = this.newConfig.agenstraParentTicketId?.trim() || null;
    } else {
      dto.confluenceSpaceKey = this.newConfig.confluenceSpaceKey?.trim() || null;
      dto.confluenceRootPageId = this.newConfig.confluenceRootPageId?.trim() || null;
      dto.cql = this.newConfig.cql?.trim() || null;
      dto.agenstraParentFolderId = this.newConfig.agenstraParentFolderId?.trim() || null;
    }

    this.facade.createConfig(dto);
  }

  openEditConfig(c: ExternalImportConfigDto): void {
    this.configToEdit = c;
    this.editConfig = {
      atlassianConnectionId: c.atlassianConnectionId,
      clientId: c.clientId,
      enabled: c.enabled,
      jiraBoardId: c.jiraBoardId ?? null,
      jql: c.jql ?? null,
      importTargetTicketStatus: c.importTargetTicketStatus ?? 'draft',
      confluenceSpaceKey: c.confluenceSpaceKey ?? null,
      confluenceRootPageId: c.confluenceRootPageId ?? null,
      cql: c.cql ?? null,
      agenstraParentTicketId: c.agenstraParentTicketId ?? null,
      agenstraParentFolderId: c.agenstraParentFolderId ?? null,
    };
    this.editConfigJiraBoardIdText = c.jiraBoardId != null ? String(c.jiraBoardId) : '';
    this.editParentTicketSearch = this.describeTicketPick(c.clientId, c.agenstraParentTicketId);
    this.editParentFolderSearch = this.describeFolderPick(c.agenstraParentFolderId);
    this.onWorkspaceDataLoad(c.clientId);
    setTimeout(() => this.showModal(this.editConfigModal));
  }

  onEditConfigModalHidden(): void {
    this.configToEdit = null;
  }

  private describeTicketPick(clientId: string, ticketId: string | null | undefined): string {
    if (!ticketId) {
      return '';
    }

    const t = this.tickets().find((x) => x.id === ticketId && x.clientId === clientId);

    return t ? this.formatTicketPick(t) : ticketId;
  }

  private describeFolderPick(folderId: string | null | undefined): string {
    if (!folderId) {
      return '';
    }

    const hit = this.editKnowledgeFoldersFlat().find((f) => f.id === folderId);

    return hit ? this.formatFolderPick(hit) : folderId;
  }

  submitEditConfig(): void {
    if (!this.configToEdit) return;

    if (this.configToEdit.importKind === 'jira' && !this.editConfig.jql?.trim()) {
      return;
    }

    if (this.configToEdit.importKind === 'confluence' && !this.editConfig.cql?.trim()) {
      return;
    }

    const dto: UpdateExternalImportConfigDto = { ...this.editConfig };

    if (this.configToEdit.importKind === 'jira') {
      dto.jiraBoardId = this.parseBoardId(this.editConfigJiraBoardIdText);
      dto.jql = this.editConfig.jql?.trim() || null;
      dto.importTargetTicketStatus = this.editConfig.importTargetTicketStatus ?? 'draft';
      dto.agenstraParentTicketId = this.editConfig.agenstraParentTicketId?.trim() || null;
      dto.confluenceSpaceKey = undefined;
      dto.confluenceRootPageId = undefined;
      dto.cql = undefined;
      dto.agenstraParentFolderId = undefined;
    } else {
      dto.confluenceSpaceKey = this.editConfig.confluenceSpaceKey?.trim() || null;
      dto.confluenceRootPageId = this.editConfig.confluenceRootPageId?.trim() || null;
      dto.cql = this.editConfig.cql?.trim() || null;
      dto.agenstraParentFolderId = this.editConfig.agenstraParentFolderId?.trim() || null;
      dto.jiraBoardId = undefined;
      dto.jql = undefined;
      dto.importTargetTicketStatus = undefined;
      dto.agenstraParentTicketId = undefined;
    }

    this.facade.updateConfig(this.configToEdit.id, dto);
  }

  runConfig(id: string): void {
    this.facade.runConfig(id);
  }

  private showModal(modalElement: ElementRef<HTMLDivElement>): void {
    if (modalElement?.nativeElement) {
      const modal = (
        window as { bootstrap?: { Modal?: { getOrCreateInstance: (el: HTMLElement) => { show: () => void } } } }
      ).bootstrap?.Modal?.getOrCreateInstance(modalElement.nativeElement);

      if (modal) {
        modal.show();
      } else {
        const ModalCtor = (window as { bootstrap?: { Modal?: new (el: HTMLElement) => { show: () => void } } })
          .bootstrap?.Modal;

        if (ModalCtor) {
          new ModalCtor(modalElement.nativeElement).show();
        }
      }
    }
  }

  private hideModal(modalElement: ElementRef<HTMLDivElement>): void {
    if (modalElement?.nativeElement) {
      const modal = (
        window as { bootstrap?: { Modal?: { getInstance: (el: HTMLElement) => { hide: () => void } | undefined } } }
      ).bootstrap?.Modal?.getInstance(modalElement.nativeElement);

      if (modal) {
        modal.hide();
      }
    }
  }

  private connectionSearchHaystack(c: AtlassianSiteConnectionDto): string {
    return [
      c.id,
      c.label ?? '',
      c.baseUrl,
      this.hostnameFromBaseUrl(c.baseUrl),
      c.accountEmail,
      c.createdAt,
      c.updatedAt,
    ]
      .join(' ')
      .toLowerCase();
  }

  private configSearchHaystack(cfg: ExternalImportConfigDto): string {
    return [
      cfg.id,
      cfg.provider,
      cfg.importKind,
      cfg.atlassianConnectionId,
      cfg.clientId,
      this.clientName(cfg.clientId),
      this.connectionNameForConfig(cfg),
      cfg.enabled
        ? $localize`:@@featureAtlassianImportAdmin-badgeOn:On`
        : $localize`:@@featureAtlassianImportAdmin-badgeOff:Off`,
      cfg.jiraBoardId != null ? String(cfg.jiraBoardId) : '',
      cfg.jql ?? '',
      cfg.importTargetTicketStatus ?? '',
      this.jiraImportTargetLabel(cfg.importTargetTicketStatus),
      cfg.confluenceSpaceKey ?? '',
      cfg.confluenceRootPageId ?? '',
      cfg.cql ?? '',
      cfg.importKind === 'confluence'
        ? buildConfluenceImportSearchCql(cfg.cql ?? '', cfg.confluenceSpaceKey, cfg.confluenceRootPageId)
        : '',
      cfg.agenstraParentTicketId ?? '',
      cfg.agenstraParentFolderId ?? '',
      cfg.lastRunAt ?? '',
      cfg.lastError ?? '',
      cfg.createdAt,
      cfg.updatedAt,
    ]
      .join(' ')
      .toLowerCase();
  }

  private hostnameFromBaseUrl(baseUrl: string): string {
    const trimmed = baseUrl.trim();

    if (!trimmed) {
      return '';
    }

    try {
      const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`;

      return new URL(withScheme).hostname;
    } catch {
      return trimmed;
    }
  }
}
