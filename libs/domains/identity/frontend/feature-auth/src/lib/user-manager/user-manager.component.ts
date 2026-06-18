import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  AuthenticationFacade,
  createUserSuccess,
  getUserRoleLabel,
  updateUserSuccess,
  type CreateUserDto,
  type UpdateUserDto,
  type UserResponseDto,
} from '@forepath/identity/frontend';
import { StandaloneLoadingService } from '@forepath/shared/frontend';
import { Actions, ofType } from '@ngrx/effects';
import { combineLatestWith, map } from 'rxjs/operators';

@Component({
  selector: 'identity-auth-user-manager',
  imports: [CommonModule, FormsModule, RouterModule],
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

  @ViewChild('createUserModal', { static: false })
  private createUserModal!: ElementRef<HTMLDivElement>;

  @ViewChild('editUserModal', { static: false })
  private editUserModal!: ElementRef<HTMLDivElement>;

  @ViewChild('deleteUserModal', { static: false })
  private deleteUserModal!: ElementRef<HTMLDivElement>;

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
        this.hideModal(this.createUserModal);
        this.hideModal(this.editUserModal);
        this.userToEdit = null;
        this.authFacade.loadUsers();
      });
  }

  onAddUser(): void {
    this.createForm = { email: '', password: '', role: 'user' };
    this.showModal(this.createUserModal);
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
    this.showModal(this.editUserModal);
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
    this.showModal(this.deleteUserModal);
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
      this.hideModal(this.deleteUserModal);
      this.userToDelete = null;
      this.authFacade.loadUsers();
    }
  }

  cancelCreateUser(): void {
    this.hideModal(this.createUserModal);
  }

  cancelEditUser(): void {
    this.hideModal(this.editUserModal);
    this.userToEdit = null;
  }

  cancelDeleteUser(): void {
    this.hideModal(this.deleteUserModal);
    this.userToDelete = null;
  }

  formatDate(iso: string | undefined): string {
    if (!iso) return '-';

    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  userRoleLabel(role: UserResponseDto['role']): string {
    return getUserRoleLabel(role);
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
