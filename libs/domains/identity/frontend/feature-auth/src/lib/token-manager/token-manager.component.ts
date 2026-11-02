import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AuthService,
  PersonalAccessTokensFacade,
  type PersonalAccessTokenResponseDto,
} from '@forepath/identity/frontend';
import {
  FpcDatePipe,
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcLabelComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcTableCellDirective,
  FpcTooltipComponent,
  fpcCopyText,
  fpcRunBulk,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { combineLatestWith, filter, firstValueFrom, map, of, pairwise, withLatestFrom } from 'rxjs';

import { sharedBulkSummary, sharedCopyIdItem } from '../data-list';

type TokenFormState = {
  name: string;
  scopes: string[];
  expiresAt: string;
};

const emptyForm = (): TokenFormState => ({
  name: '',
  scopes: [],
  expiresAt: '',
});

@Component({
  selector: 'identity-auth-token-manager',
  imports: [
    CommonModule,
    FpcDatePipe,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcLabelComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcTableCellDirective,
    FpcTooltipComponent,
  ],
  templateUrl: './token-manager.component.html',
  styleUrls: ['./token-manager.component.scss'],
  standalone: true,
})
export class IdentityTokenManagerComponent implements OnInit {
  private readonly facade = inject(PersonalAccessTokensFacade);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  readonly createTokenModalOpen = signal(false);
  readonly editTokenModalOpen = signal(false);
  readonly revokeTokenModalOpen = signal(false);

  /** Modal footer Cancel (3.38 R14: [Cancel `dark`, Primary]); the shared identity unit exists in every console. */

  readonly cancelLabel = $localize`:@@identityLogoutConfirm-cancel:Cancel`;

  readonly pageTitle = $localize`:@@featureTokenManager-title:Personal access tokens`;
  readonly addTokenTitle = $localize`:@@featureTokenManager-addTokenTitle:Create token`;
  readonly searchPlaceholder = $localize`:@@featureTokenManager-searchPlaceholder:Search tokens`;
  readonly emptyMessage = $localize`:@@featureTokenManager-empty:No personal access tokens yet`;

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly copied = signal(false);

  readonly tokens$ = this.facade.tokens$.pipe(
    combineLatestWith(this.searchQuery$),
    map(([tokens, searchQuery]) => {
      if (!searchQuery.trim()) {
        return tokens;
      }

      const normalized = searchQuery.trim().toLowerCase();

      return tokens.filter((token) => `${token.name} ${token.scopes.join(' ')}`.toLowerCase().includes(normalized));
    }),
  );

  readonly loading$ = this.facade.loading$;
  readonly error$ = this.facade.error$;
  readonly saving$ = this.facade.saving$;
  readonly revoking$ = this.facade.revoking$;
  readonly scopes$ = this.facade.scopes$;
  readonly scopesLoading$ = this.facade.scopesLoading$;
  readonly lastCreatedPlaintext$ = this.facade.lastCreatedPlaintext$;

  readonly tokens = toSignal(this.tokens$, { initialValue: [] as PersonalAccessTokenResponseDto[] });
  readonly error = toSignal(this.error$, { initialValue: null as string | null });
  readonly scopes = toSignal(this.scopes$, { initialValue: [] });
  readonly lastCreatedPlaintext = toSignal(this.lastCreatedPlaintext$, { initialValue: null as string | null });

  // Table (3.38: State column, ⋮ row actions, bulk Revoke via the single-token endpoint)
  readonly revokeLabel = $localize`:@@featureTokenManager-revoke:Revoke`;
  private readonly editLabel = $localize`:@@featureTokenManager-editButtonTitle:Edit token`;
  private readonly revokeTokenLabel = $localize`:@@featureTokenManager-revokeTitle:Revoke token`;

  readonly selectedTokenIds = signal<readonly string[]>([]);
  readonly bulkBusy = signal(false);
  readonly bulkRevokeOpen = signal(false);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);

  readonly selectedTokens = computed(() => {
    const ids = new Set(this.selectedTokenIds());

    return this.tokens().filter((token) => ids.has(token.id));
  });

  readonly columns: FpcTableColumn<PersonalAccessTokenResponseDto>[] = [
    {
      id: 'state',
      label: $localize`:@@featureTokenManager-colState:State`,
      type: 'state',
      state: (token) =>
        token.revokedAt
          ? { label: $localize`:@@featureTokenManager-stateRevoked:Revoked`, tone: 'neutral', icon: 'slash-circle' }
          : token.expiresAt && new Date(token.expiresAt).getTime() < Date.now()
            ? { label: $localize`:@@featureTokenManager-stateExpired:Expired`, tone: 'danger', icon: 'calendar-x' }
            : { label: $localize`:@@featureTokenManager-stateActive:Active`, tone: 'success', icon: 'key' },
    },
    {
      id: 'name',
      label: $localize`:@@featureTokenManager-nameLabel:Name`,
      value: (token) => token.name,
      required: true,
      priority: 1,
    },
    {
      id: 'scopes',
      label: $localize`:@@featureTokenManager-scopesLabel:Scopes`,
      priority: 1,
    },
    {
      id: 'created',
      label: $localize`:@@featureTokenManager-colCreated:Created`,
      value: (token) => token.createdAt,
      priority: 2,
    },
    {
      id: 'expires',
      label: $localize`:@@featureTokenManager-colExpires:Expires`,
      value: (token) => token.expiresAt ?? '',
      priority: 2,
    },
    {
      id: 'lastUsed',
      label: $localize`:@@featureTokenManager-colLastUsed:Last used`,
      value: (token) => token.lastUsedAt ?? '',
      priority: 3,
    },
  ];

  readonly tokenRowMenu = (): FpcMenuItem[] => [
    { id: 'edit', label: this.editLabel, icon: 'pencil' },
    sharedCopyIdItem(),
    { id: 'revoke', label: this.revokeTokenLabel, icon: 'trash', danger: true, dividerBefore: true },
  ];

  createForm = emptyForm();
  editForm = emptyForm();
  tokenToEdit: PersonalAccessTokenResponseDto | null = null;
  tokenToRevoke: PersonalAccessTokenResponseDto | null = null;

  ngOnInit(): void {
    this.facade.load();
    this.facade.loadScopes();

    this.saving$
      .pipe(
        pairwise(),
        filter(([wasSaving, saving]) => wasSaving && !saving),
        withLatestFrom(this.error$ ?? of(null)),
        filter(([, error]) => !error),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        if (!this.tokenToEdit) {
          return;
        }

        this.editTokenModalOpen.set(false);
        this.tokenToEdit = null;
        this.editForm = emptyForm();
      });
  }

  onAddToken(): void {
    this.createForm = emptyForm();
    this.facade.clearCreatedPlaintext();
    this.copied.set(false);
    this.createTokenModalOpen.set(true);
  }

  onSubmitCreateToken(): void {
    if (!this.isFormValid(this.createForm)) {
      return;
    }

    const dto: { name: string; scopes: string[]; expiresAt?: string } = {
      name: this.createForm.name.trim(),
      scopes: [...this.createForm.scopes],
    };

    if (this.createForm.expiresAt.trim()) {
      dto.expiresAt = new Date(this.createForm.expiresAt).toISOString();
    }

    this.facade.create(dto);
  }

  onCreateDone(): void {
    this.facade.clearCreatedPlaintext();
    this.createTokenModalOpen.set(false);
    this.createForm = emptyForm();
    this.copied.set(false);
  }

  onEditToken(token: PersonalAccessTokenResponseDto): void {
    this.tokenToEdit = token;
    this.editForm = {
      name: token.name,
      scopes: [...token.scopes],
      expiresAt: '',
    };
    this.editTokenModalOpen.set(true);
  }

  onSubmitEditToken(): void {
    if (!this.tokenToEdit || !this.isFormValid(this.editForm)) {
      return;
    }

    this.facade.update(this.tokenToEdit.id, {
      name: this.editForm.name.trim(),
      scopes: [...this.editForm.scopes],
    });
  }

  cancelEditToken(): void {
    this.editTokenModalOpen.set(false);
    this.tokenToEdit = null;
    this.editForm = emptyForm();
  }

  onRevokeToken(token: PersonalAccessTokenResponseDto): void {
    this.tokenToRevoke = token;
    this.revokeTokenModalOpen.set(true);
  }

  confirmRevokeToken(): void {
    if (!this.tokenToRevoke) {
      return;
    }

    this.facade.revoke(this.tokenToRevoke.id);
    this.revokeTokenModalOpen.set(false);
    this.tokenToRevoke = null;
  }

  cancelRevokeToken(): void {
    this.revokeTokenModalOpen.set(false);
    this.tokenToRevoke = null;
  }

  toggleScope(form: TokenFormState, scope: string, checked: boolean): void {
    if (checked) {
      form.scopes = [...new Set([...form.scopes, scope])];

      return;
    }

    form.scopes = form.scopes.filter((item) => item !== scope);
  }

  isScopeSelected(form: TokenFormState, scope: string): boolean {
    return form.scopes.includes(scope);
  }

  isFormValid(form: TokenFormState): boolean {
    return form.name.trim().length > 0 && form.scopes.length > 0;
  }

  async copyPlaintext(): Promise<void> {
    const plaintext = this.lastCreatedPlaintext();

    if (!plaintext || !navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(plaintext);
      this.copied.set(true);
    } catch {
      this.copied.set(false);
    }
  }

  scopesText(token: PersonalAccessTokenResponseDto): string {
    return token.scopes.join('\n');
  }

  scopeCount(token: PersonalAccessTokenResponseDto): number {
    return token.scopes.length;
  }

  rowKey(token: PersonalAccessTokenResponseDto): string {
    return token.id;
  }

  onTokenAction(token: PersonalAccessTokenResponseDto, action: string): void {
    switch (action) {
      case 'edit':
        this.onEditToken(token);
        break;
      case 'copy-id':
        fpcCopyText(token.id);
        break;
      case 'revoke':
        this.onRevokeToken(token);
        break;
    }
  }

  /** Bulk Revoke: one revoke call per selected token (the server checks each), per-token result. */
  async onConfirmBulkRevoke(): Promise<void> {
    this.bulkRevokeOpen.set(false);
    const tokens = this.selectedTokens();

    if (tokens.length === 0) {
      return;
    }

    this.bulkBusy.set(true);
    this.bulkResult.set(null);

    try {
      const result = await fpcRunBulk(tokens, (token) =>
        firstValueFrom(this.authService.revokePersonalAccessToken(token.id)),
      );

      this.bulkResult.set(sharedBulkSummary(result, (token) => token.name));
      this.selectedTokenIds.set(result.failed.concat(result.denied).map((token) => token.id));
      this.facade.load();
    } finally {
      this.bulkBusy.set(false);
    }
  }
}
