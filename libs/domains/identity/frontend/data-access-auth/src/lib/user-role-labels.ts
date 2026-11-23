import type { UserRole } from './state/authentication/authentication.types';

/** Maps API user role values to localized, human-readable labels. */
export function getUserRoleLabel(role: UserRole | string | null | undefined): string {
  switch (role) {
    case 'admin':
      return $localize`:@@featureUserManager-roleAdmin:Admin`;
    case 'manager':
      return $localize`:@@featureUserManager-roleManager:Manager`;
    case 'user':
      return $localize`:@@featureUserManager-roleUser:User`;
    default:
      if (role == null || role === '') {
        return $localize`:@@featureUserManager-roleUnknown:Unknown`;
      }

      return $localize`:@@featureUserManager-roleUnknownValue:Unknown (${role})`;
  }
}
