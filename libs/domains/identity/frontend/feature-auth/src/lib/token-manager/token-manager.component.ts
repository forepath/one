import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { PersonalAccessTokensFacade, type PersonalAccessTokenResponseDto } from '@forepath/identity/frontend';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcLabelComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
  FpcTooltipComponent,
} from '@forepath/shared/frontend/ui-components';
import { combineLatestWith, filter, map, of, pairwise, withLatestFrom } from 'rxjs';

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
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcLabelComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
    FpcTooltipComponent,
  ],
  templateUrl: './token-manager.component.html',
  styleUrls: ['./token-manager.component.scss'],
  standalone: true,
})
export class IdentityTokenManagerComponent implements OnInit {
  private readonly facade = inject(PersonalAccessTokensFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly createTokenModalOpen = signal(false);
  readonly editTokenModalOpen = signal(false);
  readonly revokeTokenModalOpen = signal(false);

  readonly pageTitle = $localize`:@@featureTokenManager-title:Personal Access Tokens`;
  readonly addTokenTitle = $localize`:@@featureTokenManager-addTokenTitle:Create token`;
  readonly searchPlaceholder = $localize`:@@featureTokenManager-searchPlaceholder:Search tokens`;
  readonly loadingLabel = $localize`:@@featureTokenManager-loading:Loading tokens...`;
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

      return tokens.filter((token) => JSON.stringify(token).toLowerCase().includes(normalized));
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

  formatDate(iso: string | null | undefined): string {
    if (!iso) {
      return '—';
    }

    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }
}
