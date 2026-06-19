import { Pipe, PipeTransform } from '@angular/core';

import { getUserRoleLabel } from './user-role-labels';

@Pipe({
  name: 'userRoleLabel',
  standalone: true,
})
export class UserRoleLabelPipe implements PipeTransform {
  transform(role: string | null | undefined): string {
    return getUserRoleLabel(role);
  }
}
