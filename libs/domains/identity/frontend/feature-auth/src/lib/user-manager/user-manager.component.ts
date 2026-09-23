import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  AuthenticationFacade,
  adminClearTotpSuccess,
  createUserSuccess,
  updateUserSuccess,
  UserRoleLabelPipe,
  type CreateUserDto,
  type UpdateUserDto,
  type UserResponseDto,
} from '@forepath/identity/frontend';
import { StandaloneLoadingService } from '@forepath/shared/frontend';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { Actions, ofType } from '@ngrx/effects';
import { combineLatestWith, map } from 'rxjs/operators';

@Component({
  selector: 'identity-auth-user-manager',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    UserRoleLabelPipe,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './user-manager.component.html',
  styleUrls: ['./user-manager.component.scss'],
  standalone: true,
})
export class IdentityUserManagerComponent implements OnInit {
  private readonly authFacade = inject(AuthenticationFacade);
  private readonly actions$ = inject(Actions);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly standaloneLoadingService = inject(StandaloneLoadingService);

  readonly createUserModalOpen = signal(false);
  readonly editUserModalOpen = signal(false);
  readonly deleteUserModalOpen = signal(false);
  readonly clearTotpModalOpen = signal(false);

  readonly pageTitle = $localize`:@@featureUserManager-title:User Management`;
  readonly addUserTitle = $localize`:@@featureUserManager-addUserTitle:Add user`;
  readonly searchUsersPlaceholder = $localize`:@@featureUserManager-searchUsersPlaceholder:Search users`;
  readonly loadingUsersLabel = $localize`:@@featureUserManager-loadingUsers:Loading users...`;
  readonly noOtherUsersMessage = $localize`:@@featureUserManager-noOtherUsers:No other users yet`;

  readonly searchUserQuery = signal<string>('');
  readonly searchUserQuery$ = toObservable(this.searchUserQuery);
  readonly users$ = this.authFacade.users$.pipe(
    combineLatestWith(this.searchUserQuery$),
    map(([users, searchQuery]) => {
      if (!searchQuery) {
        return users;
      }

      return users.filter((user) => JSON.stringify(user).toLowerCase().includes(searchQuery.toLowerCase()));
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

  formatDate(iso: string | undefined): string {
    if (!iso) return '-';

    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }
}
