import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, InjectionToken } from '@angular/core';
import { IDENTITY_AUTH_ENVIRONMENT } from '@forepath/identity/frontend';
import { Observable } from 'rxjs';

import type {
  CreateUserDto,
  LoginResponse,
  RegisterResponse,
  UpdateUserDto,
  UserResponseDto,
} from '../state/authentication/authentication.types';

/**
 * Injection token to configure the post-login redirect target.
 *
 * The value should be an array of path segments suitable for
 * `Router.navigate`, e.g. `['/clients']` or `['/dashboard']`.
 *
 * Defaults to `['/clients']` to preserve existing behavior.
 */
export const LOGIN_SUCCESS_REDIRECT_TARGET = new InjectionToken<string[]>('LoginSuccessRedirectTarget');

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly authEnvironment = inject(IDENTITY_AUTH_ENVIRONMENT);

  private get apiUrl(): string {
    return this.authEnvironment.apiUrl;
  }

  login(email: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.apiUrl}/auth/login`, { email, password });
  }

  register(email: string, password: string): Observable<RegisterResponse> {
    return this.http.post<RegisterResponse>(`${this.apiUrl}/auth/register`, { email, password });
  }

  confirmEmail(email: string, code: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/auth/confirm-email`, {
      email,
      code,
    });
  }

  requestPasswordReset(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/auth/request-password-reset`, { email });
  }

  resetPassword(email: string, code: string, newPassword: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/auth/reset-password`, {
      email,
      code,
      newPassword,
    });
  }

  changePassword(
    currentPassword: string,
    newPassword: string,
    newPasswordConfirmation: string,
  ): Observable<{ message: string; access_token: string }> {
    return this.http.post<{ message: string; access_token: string }>(`${this.apiUrl}/auth/change-password`, {
      currentPassword,
      newPassword,
      newPasswordConfirmation,
    });
  }

  logout(invalidateAllSessions = false): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/auth/logout`, { invalidateAllSessions });
  }

  listUsers(params?: { limit?: number; offset?: number }): Observable<UserResponseDto[]> {
    let httpParams = new HttpParams();

    if (params?.limit !== undefined) {
      httpParams = httpParams.set('limit', params.limit.toString());
    }

    if (params?.offset !== undefined) {
      httpParams = httpParams.set('offset', params.offset.toString());
    }

    return this.http.get<UserResponseDto[]>(`${this.apiUrl}/users`, { params: httpParams });
  }

  getUser(id: string): Observable<UserResponseDto> {
    return this.http.get<UserResponseDto>(`${this.apiUrl}/users/${id}`);
  }

  createUser(user: CreateUserDto): Observable<UserResponseDto> {
    return this.http.post<UserResponseDto>(`${this.apiUrl}/users`, user);
  }

  updateUser(id: string, user: UpdateUserDto): Observable<UserResponseDto> {
    return this.http.post<UserResponseDto>(`${this.apiUrl}/users/${id}`, user);
  }

  deleteUser(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/users/${id}`);
  }

  lockUser(id: string): Observable<UserResponseDto> {
    return this.http.post<UserResponseDto>(`${this.apiUrl}/users/${id}/lock`, {});
  }

  unlockUser(id: string): Observable<UserResponseDto> {
    return this.http.post<UserResponseDto>(`${this.apiUrl}/users/${id}/unlock`, {});
  }
}
