import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  AuthService,
  AuthenticationFacade,
  adminClearTotpSuccess,
  getUserRoleLabel,
  createUserSuccess,
  updateUserSuccess,
  type CreateUserDto,
  type UpdateUserDto,
  type UserResponseDto,
} from '@forepath/identity/frontend';
import { StandaloneLoadingService } from '@forepath/shared/frontend';
import {
  FpcDatePipe,
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcTableCellDirective,
  fpcCopyText,
  fpcRunBulk,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { Actions, ofType } from '@ngrx/effects';
import { firstValueFrom } from 'rxjs';
import { combineLatestWith, map } from 'rxjs/operators';

import { SHARED_DL_DELETE, sharedBulkSummary, sharedCopyIdItem } from '../data-list';

@Component({
  selector: 'identity-auth-user-manager',
  imports: [
    CommonModule,
    FpcDatePipe,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcTableCellDirective,
  ],
  templateUrl: './user-manager.component.html',
  styleUrls: ['./user-manager.component.scss'],
  standalone: true,
})
export class IdentityUserManagerComponent implements OnInit {
  private readonly authFacade = inject(AuthenticationFacade);
  private readonly authService = inject(AuthService);
  private readonly actions$ = inject(Actions);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly standaloneLoadingService = inject(StandaloneLoadingService);

  readonly createUserModalOpen = signal(false);
  readonly editUserModalOpen = signal(false);
  readonly deleteUserModalOpen = signal(false);
  readonly clearTotpModalOpen = signal(false);

  /** Modal footer Cancel (3.38 R14: [Cancel `dark`, Primary]); the shared identity unit exists in every console. */

  readonly cancelLabel = $localize`:@@identityLogoutConfirm-cancel:Cancel`;

  readonly pageTitle = $localize`:@@featureUserManager-title:User management`;
  readonly addUserTitle = $localize`:@@featureUserManager-addUserTitle:Add user`;
  readonly searchUsersPlaceholder = $localize`:@@featureUserManager-searchUsersPlaceholder:Search users`;
  readonly noOtherUsersMessage = $localize`:@@featureUserManager-noOtherUsers:No other users yet`;

  readonly searchUserQuery = signal<string>('');
  readonly searchUserQuery$ = toObservable(this.searchUserQuery);
  readonly users$ = this.authFacade.users$.pipe(
    combineLatestWith(this.searchUserQuery$),
    map(([users, searchQuery]) => {
      if (!searchQuery) {
        return users;
      }

      const needle = searchQuery.trim().toLowerCase();

      return users.filter((user) => `${user.email} ${getUserRoleLabel(user.role)}`.toLowerCase().includes(needle));
    }),
  );
  readonly usersLoading$ = this.authFacade.usersLoading$;
  readonly usersError$ = this.authFacade.usersError$;
  readonly creatingUser$ = this.authFacade.creatingUser$;
  readonly updatingUser$ = this.authFacade.updatingUser$;
  readonly deletingUser$ = this.authFacade.deletingUser$;
  readonly lockingUser$ = this.authFacade.lockingUser$;
  readonly unlockingUser$ = this.authFacade.unlockingUser$;

  readonly users = toSignal(this.users$, { initialValue: [] as UserResponseDto[] });
  readonly currentUser = toSignal(this.authFacade.user$, { initialValue: null });
  /** Users list excluding the current user (anti-lockout) */
  readonly usersExcludingSelf = computed(() => {
    const all = this.users();
    const self = this.currentUser();

    if (!self?.id) return all;

    return all.filter((u) => u.id !== self.id);
  });
  readonly usersError = toSignal(this.usersError$, { initialValue: null as string | null });

  // Table (3.38: State column, ⋮ row actions, bulk Lock / Unlock / Delete via the single-user endpoints)
  readonly lockLabel = $localize`:@@featureUserManager-lockUserButtonTitle:Lock user`;
  readonly unlockLabel = $localize`:@@featureUserManager-unlockUserButtonTitle:Unlock user`;
  readonly deleteLabel = SHARED_DL_DELETE;
  readonly authenticatorLabel = $localize`:@@featureUserManager-totpEnabled:Authenticator`;
  private readonly editLabel = $localize`:@@featureUserManager-editUserButtonTitle:Edit user`;
  private readonly removeAuthenticatorLabel = $localize`:@@featureUserManager-removeAuthenticatorTitle:Remove authenticator`;

  readonly selectedUserIds = signal<readonly string[]>([]);
  readonly bulkBusy = signal(false);
  readonly bulkDeleteOpen = signal(false);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);

  readonly selectedUsers = computed(() => {
    const ids = new Set(this.selectedUserIds());

    return this.usersExcludingSelf().filter((user) => ids.has(user.id));
  });

  readonly columns: FpcTableColumn<UserResponseDto>[] = [
    {
      id: 'state',
      label: $localize`:@@featureUserManager-colState:State`,
      type: 'state',
      state: (user) =>
        user.lockedAt
          ? { label: $localize`:@@featureUserManager-locked:Locked`, tone: 'danger', icon: 'lock-fill' }
          : !user.emailConfirmedAt
            ? {
                label: $localize`:@@featureUserManager-stateUnconfirmed:Email not confirmed`,
                tone: 'warning',
                icon: 'envelope-exclamation',
              }
            : { label: $localize`:@@featureUserManager-unlocked:Active`, tone: 'success', icon: 'person-check' },
    },
    {
      id: 'name',
      label: $localize`:@@featureUserManager-emailLabel:Email`,
      value: (user) => user.email,
      required: true,
      priority: 1,
    },
    {
      id: 'role',
      label: $localize`:@@featureUserManager-colRole:Role`,
      value: (user) => getUserRoleLabel(user.role),
      priority: 1,
    },
    {
      id: 'authenticator',
      label: $localize`:@@featureUserManager-totpEnabled:Authenticator`,
      priority: 2,
      width: '7rem',
      // Mostly empty (AG-17): hidden by default, still available in the column chooser.
      hidden: true,
    },
    {
      id: 'created',
      label: $localize`:@@featureUserManager-colCreated:Created`,
      value: (user) => user.createdAt,
      priority: 2,
    },
  ];

  readonly userRowMenu = (user: UserResponseDto): FpcMenuItem[] => {
    const items: FpcMenuItem[] = [
      { id: 'edit', label: this.editLabel, icon: 'pencil' },
      user.lockedAt
        ? { id: 'unlock', label: this.unlockLabel, icon: 'unlock' }
        : { id: 'lock', label: this.lockLabel, icon: 'lock' },
    ];

    if (user.totpEnabled) {
      items.push({ id: 'clear-totp', label: this.removeAuthenticatorLabel, icon: 'shield-x' });
    }

    items.push(sharedCopyIdItem(), {
      id: 'delete',
      label: this.deleteLabel,
      icon: 'trash',
      danger: true,
      dividerBefore: true,
    });

    return items;
  };

  createForm = {
    email: '',
    password: '',
    role: 'user' as 'user' | 'admin',
  };

  editForm = {
    email: '',
    password: '',
    role: 'user' as 'user' | 'admin',
  };

  userToEdit: UserResponseDto | null = null;
  userToDelete: UserResponseDto | null = null;
  userToClearTotp: UserResponseDto | null = null;

  ngOnInit(): void {
    this.authFacade.loadUsers();

    // Clear standalone loading overlay when user manager is shown (e.g. opened in new window)
    const isStandalone = !!this.route.snapshot.queryParams['standalone'];

    if (isStandalone) {
      this.standaloneLoadingService.setLoading(false);
    }

    this.actions$
      .pipe(ofType(createUserSuccess, updateUserSuccess), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.createUserModalOpen.set(false);
        this.editUserModalOpen.set(false);
        this.userToEdit = null;
        this.authFacade.loadUsers();
      });

    this.actions$.pipe(ofType(adminClearTotpSuccess), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.clearTotpModalOpen.set(false);
      this.userToClearTotp = null;
      this.authFacade.loadUsers();
    });
  }

  onAddUser(): void {
    this.createForm = { email: '', password: '', role: 'user' };
    this.createUserModalOpen.set(true);
  }

  onSubmitCreateUser(): void {
    const dto: CreateUserDto = {
      email: this.createForm.email.trim(),
      password: this.createForm.password,
      role: this.createForm.role,
    };

    this.authFacade.createUser(dto);
  }

  onEditUser(user: UserResponseDto): void {
    this.userToEdit = user;
    this.editForm = {
      email: user.email,
      password: '',
      role: user.role,
    };
    this.editUserModalOpen.set(true);
  }

  onSubmitEditUser(): void {
    if (!this.userToEdit) return;

    const dto: UpdateUserDto = {
      email: this.editForm.email.trim(),
      role: this.editForm.role,
    };

    if (this.editForm.password.trim()) {
      dto.password = this.editForm.password;
    }

    this.authFacade.updateUser(this.userToEdit.id, dto);
  }

  onDeleteUser(user: UserResponseDto): void {
    this.userToDelete = user;
    this.deleteUserModalOpen.set(true);
  }

  onClearTotp(user: UserResponseDto): void {
    this.userToClearTotp = user;
    this.clearTotpModalOpen.set(true);
  }

  onLockUser(user: UserResponseDto): void {
    this.authFacade.lockUser(user.id);
  }

  onUnlockUser(user: UserResponseDto): void {
    this.authFacade.unlockUser(user.id);
  }

  confirmDeleteUser(): void {
    if (this.userToDelete) {
      this.authFacade.deleteUser(this.userToDelete.id);
      this.deleteUserModalOpen.set(false);
      this.userToDelete = null;
      this.authFacade.loadUsers();
    }
  }

  cancelCreateUser(): void {
    this.createUserModalOpen.set(false);
  }

  cancelEditUser(): void {
    this.editUserModalOpen.set(false);
    this.userToEdit = null;
  }

  cancelDeleteUser(): void {
    this.deleteUserModalOpen.set(false);
    this.userToDelete = null;
  }

  confirmClearTotp(): void {
    if (this.userToClearTotp) {
      this.authFacade.adminClearTotp(this.userToClearTotp.id);
    }
  }

  cancelClearTotp(): void {
    this.clearTotpModalOpen.set(false);
    this.userToClearTotp = null;
  }

  onUserAction(user: UserResponseDto, action: string): void {
    switch (action) {
      case 'edit':
        this.onEditUser(user);
        break;
      case 'lock':
        this.onLockUser(user);
        break;
      case 'unlock':
        this.onUnlockUser(user);
        break;
      case 'clear-totp':
        this.onClearTotp(user);
        break;
      case 'copy-id':
        fpcCopyText(user.id);
        break;
      case 'delete':
        this.onDeleteUser(user);
        break;
    }
  }

  /** Bulk Lock / Unlock: one call per selected user whose state changes (the server checks each). */
  onBulkLock(lock: boolean): void {
    void this.runBulk(
      this.selectedUsers().filter((user) => !!user.lockedAt !== lock),
      (user) => firstValueFrom(lock ? this.authService.lockUser(user.id) : this.authService.unlockUser(user.id)),
    );
  }

  onConfirmBulkDelete(): void {
    this.bulkDeleteOpen.set(false);
    void this.runBulk(this.selectedUsers(), (user) => firstValueFrom(this.authService.deleteUser(user.id)));
  }

  /** Client fan-out over the single-user endpoints (3.38 D8), per-user result; failed / denied stay selected. */
  private async runBulk(users: readonly UserResponseDto[], run: (user: UserResponseDto) => Promise<unknown>) {
    if (users.length === 0) {
      return;
    }

    this.bulkBusy.set(true);
    this.bulkResult.set(null);

    try {
      const result = await fpcRunBulk(users, run);

      this.bulkResult.set(sharedBulkSummary(result, (user) => user.email));
      this.selectedUserIds.set(result.failed.concat(result.denied).map((user) => user.id));
      this.authFacade.loadUsers();
    } finally {
      this.bulkBusy.set(false);
    }
  }
}
