import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type { AccessMe } from '../types/console.types';
import { ConsoleApi } from './console-api';

@Injectable({ providedIn: 'root' })
export class AccessService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  me(): Observable<AccessMe> {
    return this.http.get<AccessMe>(this.url('/access/me'));
  }
}
