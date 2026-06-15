import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  ClientsFacade,
  FilterRulesFacade,
  createFilterRuleSuccess,
  deleteFilterRuleSuccess,
  updateFilterRuleSuccess,
  type ClientResponseDto,
  type CreateFilterRuleDto,
  type FilterRuleResponseDto,
  type FilterRuleWorkspaceSyncDto,
  type UpdateFilterRuleDto,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import { Actions, ofType } from '@ngrx/effects';

import {
  filterRuleDirectionLabel,
  filterRuleTesterNoContentChange,
  filterRuleTesterNoMatch,
  filterRuleTesterReplacedMessage,
  filterRuleTesterWouldDrop,
  filterRuleTypeLabel,
  filterRuleWorkspaceSyncTitle,
} from './filter-rule-labels';

@Component({
  selector: 'framework-rule-manager',
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './rule-manager.component.html',
  styleUrls: ['./rule-manager.component.scss'],
  standalone: true,
})
export class RuleManagerComponent implements OnInit {
  readonly directionLabel = filterRuleDirectionLabel;
  readonly filterTypeLabel = filterRuleTypeLabel;
  readonly workspaceSyncTitle = filterRuleWorkspaceSyncTitle;

  private readonly filterRulesFacade = inject(FilterRulesFacade);
  private readonly clientsFacade = inject(ClientsFacade);
  private readonly actions$ = inject(Actions);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('createModal', { static: false }) createModal!: ElementRef<HTMLDivElement>;
  @ViewChild('editModal', { static: false }) editModal!: ElementRef<HTMLDivElement>;
  @ViewChild('deleteModal', { static: false }) deleteModal!: ElementRef<HTMLDivElement>;
  @ViewChild('testerModal', { static: false }) testerModal!: ElementRef<HTMLDivElement>;

  readonly rules$ = this.filterRulesFacade.rules$;
  readonly rules = toSignal(this.rules$, { initialValue: [] as FilterRuleResponseDto[] });
  readonly loading$ = this.filterRulesFacade.loading$;
  readonly error$ = this.filterRulesFacade.error$;
  readonly saving$ = this.filterRulesFacade.saving$;
  readonly deleting$ = this.filterRulesFacade.deleting$;

  readonly clients = toSignal(this.clientsFacade.clients$, { initialValue: [] as ClientResponseDto[] });

  searchQuery = '';

  ruleToDelete: FilterRuleResponseDto | null = null;
  ruleToTest: FilterRuleResponseDto | null = null;
  testerInput = '';
  testerResult: { ok: boolean; message: string } | null = null;

  createForm: CreateFilterRuleDto = {
    pattern: '',
    regexFlags: 'g',
    direction: 'incoming',
    filterType: 'none',
    isGlobal: true,
    priority: 0,
    enabled: true,
  };

  createWorkspaceSelection: Record<string, boolean> = {};

  editRule: FilterRuleResponseDto | null = null;
  editForm: UpdateFilterRuleDto & { workspaceIdsSelected: Record<string, boolean> } = {
    workspaceIdsSelected: {},
  };

  ngOnInit(): void {
    this.filterRulesFacade.load();
    this.clientsFacade.loadClients({ limit: 500, offset: 0 });
    this.actions$
      .pipe(ofType(createFilterRuleSuccess, updateFilterRuleSuccess), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.hideModal(this.createModal);
        this.hideModal(this.editModal);
        this.editRule = null;
      });
    this.actions$.pipe(ofType(deleteFilterRuleSuccess), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.hideModal(this.deleteModal);
      this.ruleToDelete = null;
    });
  }

  filteredRules(): FilterRuleResponseDto[] {
    const q = this.searchQuery.trim().toLowerCase();
    const list = this.rules();

    if (!q) {
      return list;
    }

    return list.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  }

  clientName(id: string): string {
    return this.clients().find((c) => c.id === id)?.name ?? id;
  }

  workspaceSyncRow(rule: FilterRuleResponseDto, clientId: string): FilterRuleWorkspaceSyncDto | undefined {
    return (rule.workspaceSync ?? []).find((w) => w.clientId === clientId);
  }

  sortedWorkspaceSync(rule: FilterRuleResponseDto): FilterRuleWorkspaceSyncDto[] {
    const rows = rule.workspaceSync ?? [];

    return [...rows].sort((a, b) => this.clientName(a.clientId).localeCompare(this.clientName(b.clientId)));
  }

  syncWorkspaceIconClass(row: FilterRuleWorkspaceSyncDto | undefined): string {
    const s = row?.syncStatus ?? 'pending';

    if (s === 'synced') {
      return 'bi bi-check-circle text-success';
    }

    if (s === 'failed') {
      return 'bi bi-x-circle text-danger';
    }

    return 'bi bi-clock text-warning';
  }

  statusLabel(rule: FilterRuleResponseDto): 'inactive' | 'active' | 'synced' {
    if (!rule.enabled) {
      return 'inactive';
    }

    if (rule.sync.pending > 0 || rule.sync.failed > 0) {
      return 'active';
    }

    return 'synced';
  }

  onAdd(): void {
    this.createForm = {
      pattern: '',
      regexFlags: 'g',
      direction: 'incoming',
      filterType: 'none',
      isGlobal: true,
      priority: 0,
      enabled: true,
    };
    const sel: Record<string, boolean> = {};

    for (const c of this.clients()) {
      sel[c.id] = false;
    }

    this.createWorkspaceSelection = sel;
    this.showModal(this.createModal);
  }

  submitCreate(): void {
    const dto: CreateFilterRuleDto = {
      pattern: this.createForm.pattern.trim(),
      regexFlags: this.createForm.regexFlags?.trim() || 'g',
      direction: this.createForm.direction,
      filterType: this.createForm.filterType,
      priority: this.createForm.priority ?? 0,
      enabled: this.createForm.enabled ?? true,
      isGlobal: this.createForm.isGlobal,
      replaceContent: this.createForm.filterType === 'filter' ? this.createForm.replaceContent : undefined,
    };

    if (!dto.isGlobal) {
      dto.workspaceIds = this.selectedIdsFromMap(this.createWorkspaceSelection);
    }

    this.filterRulesFacade.create(dto);
  }

  onEdit(rule: FilterRuleResponseDto): void {
    this.editRule = rule;
    const selected: Record<string, boolean> = {};

    for (const c of this.clients()) {
      selected[c.id] = rule.workspaceIds.includes(c.id);
    }

    this.editForm = {
      pattern: rule.pattern,
      regexFlags: rule.regexFlags,
      direction: rule.direction,
      filterType: rule.filterType,
      replaceContent: rule.replaceContent ?? undefined,
      priority: rule.priority,
      enabled: rule.enabled,
      isGlobal: rule.isGlobal,
      workspaceIds: [...rule.workspaceIds],
      workspaceIdsSelected: selected,
    };
    this.showModal(this.editModal);
  }

  submitEdit(): void {
    if (!this.editRule) {
      return;
    }

    const dto: UpdateFilterRuleDto = {
      pattern: this.editForm.pattern?.trim(),
      regexFlags: this.editForm.regexFlags?.trim(),
      direction: this.editForm.direction,
      filterType: this.editForm.filterType,
      replaceContent: this.editForm.filterType === 'filter' ? this.editForm.replaceContent : null,
      priority: this.editForm.priority,
      enabled: this.editForm.enabled,
      isGlobal: this.editForm.isGlobal,
    };

    if (this.editForm.isGlobal) {
      delete dto.workspaceIds;
    } else {
      dto.workspaceIds = this.selectedIdsFromMap(this.editForm.workspaceIdsSelected);
    }

    this.filterRulesFacade.update(this.editRule.id, dto);
  }

  onDelete(rule: FilterRuleResponseDto): void {
    this.ruleToDelete = rule;
    this.showModal(this.deleteModal);
  }

  confirmDelete(): void {
    if (this.ruleToDelete) {
      this.filterRulesFacade.delete(this.ruleToDelete.id);
    }
  }

  onTest(rule: FilterRuleResponseDto): void {
    this.ruleToTest = rule;
    this.testerInput = '';
    this.testerResult = null;
    this.showModal(this.testerModal);
  }

  runTester(): void {
    const rule = this.ruleToTest;

    if (!rule) {
      return;
    }

    try {
      const re = new RegExp(rule.pattern, rule.regexFlags || 'g');
      const text = this.testerInput;
      const matched = re.test(text);

      re.lastIndex = 0;

      if (!matched) {
        this.testerResult = { ok: true, message: filterRuleTesterNoMatch() };

        return;
      }

      if (rule.filterType === 'drop') {
        this.testerResult = { ok: true, message: filterRuleTesterWouldDrop() };

        return;
      }

      if (rule.filterType === 'none') {
        this.testerResult = { ok: true, message: filterRuleTesterNoContentChange() };

        return;
      }

      re.lastIndex = 0;
      const replaced = text.replace(re, rule.replaceContent ?? '');

      this.testerResult = { ok: true, message: filterRuleTesterReplacedMessage(replaced) };
    } catch (e) {
      this.testerResult = { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  toggleCreateWorkspace(id: string): void {
    this.createWorkspaceSelection[id] = !this.createWorkspaceSelection[id];
  }

  toggleEditWorkspace(id: string): void {
    this.editForm.workspaceIdsSelected[id] = !this.editForm.workspaceIdsSelected[id];
  }

  private selectedIdsFromMap(m: Record<string, boolean>): string[] {
    return Object.entries(m)
      .filter(([, v]) => v)
      .map(([k]) => k);
  }

  cancelCreate(): void {
    this.hideModal(this.createModal);
  }

  cancelEdit(): void {
    this.hideModal(this.editModal);
    this.editRule = null;
  }

  cancelDelete(): void {
    this.hideModal(this.deleteModal);
    this.ruleToDelete = null;
  }

  cancelTest(): void {
    this.hideModal(this.testerModal);
    this.ruleToTest = null;
  }

  private showModal(modalElement: ElementRef<HTMLDivElement>): void {
    if (modalElement?.nativeElement) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const modal = (window as any).bootstrap?.Modal?.getOrCreateInstance(modalElement.nativeElement);

      if (modal) {
        modal.show();
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Modal = (window as any).bootstrap?.Modal;

        if (Modal) {
          new Modal(modalElement.nativeElement).show();
        }
      }
    }
  }

  private hideModal(modalElement: ElementRef<HTMLDivElement>): void {
    if (modalElement?.nativeElement) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const modal = (window as any).bootstrap?.Modal?.getInstance(modalElement.nativeElement);

      if (modal) {
        modal.hide();
      }
    }
  }
}
