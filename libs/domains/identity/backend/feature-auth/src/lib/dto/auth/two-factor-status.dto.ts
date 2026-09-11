import type { Login2faMethod } from '../../constants/auth-error.constants';

export class TwoFactorStatusDto {
  forceEnabled!: boolean;
  emailEnabled!: boolean;
  totpEnabled!: boolean;
  /** Preferred challenge method when a second factor applies. */
  method!: Login2faMethod | null;
}
