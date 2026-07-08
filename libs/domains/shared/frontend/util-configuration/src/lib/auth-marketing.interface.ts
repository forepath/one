export interface AuthMarketingFeature {
  title: string;
  description: string;
}

export interface AuthMarketing {
  loginDescription: string;
  registerDescription: string;
  requestPasswordResetDescription: string;
  resetPasswordConfirmationDescription: string;
  resetPasswordDescription: string;
  confirmEmailDescription: string;
  /** Statutory withdrawal page copy (Decabill). */
  publicWithdrawalDescription?: string;
  features: AuthMarketingFeature[];
}
