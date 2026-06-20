import { AuthMarketing } from './auth-marketing.interface';

export const decabillAuthMarketing: AuthMarketing = {
  loginDescription:
    'Manage subscriptions, invoices, and billing profiles from one place. Decabill gives finance and operations teams a clear view of plans, payments, and customer accounts.',
  registerDescription:
    'Create your Decabill account to manage subscriptions and billing. After registration, you will receive an email to confirm your account before you can log in.',
  requestPasswordResetDescription:
    'Enter your email address and we will send you instructions to reset your Decabill account password. If an account exists for that email, you will receive them shortly.',
  resetPasswordConfirmationDescription:
    'If an account exists for the email you entered, you will receive a password reset code. Enter the code below and choose a new password for your Decabill account.',
  resetPasswordDescription:
    'Enter the reset code you received via email and choose a new password for your Decabill account.',
  confirmEmailDescription:
    'Enter the 6-character confirmation code you received via email (letters and numbers). You can paste the code or type it in the fields below.',
  features: [
    {
      title: 'Plans & Subscriptions',
      description: 'Review active plans, renewals, and subscription changes in one place',
    },
    {
      title: 'Invoices & Payments',
      description: 'Download invoices and track payment status in real time',
    },
    {
      title: 'Billing Administration',
      description: 'Configure service plans, types, and customer billing profiles',
    },
    {
      title: 'Usage Overview',
      description: 'Monitor consumption, open balances, and billing periods at a glance',
    },
  ],
};
