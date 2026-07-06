import { AuthMarketing } from './auth-marketing.interface';

export const marpdownAuthMarketing: AuthMarketing = {
  loginDescription:
    'Sign in to create, edit, and export Marp presentations. Manage slide decks, assets, and exports from one editor.',
  registerDescription:
    'Create your Marpdown account to start building presentations. After registration, confirm your email before signing in.',
  requestPasswordResetDescription:
    'Enter your email address and we will send password reset instructions for your Marpdown account.',
  resetPasswordConfirmationDescription:
    'If an account exists for the email you entered, you will receive a password reset code. Enter it below with a new password.',
  resetPasswordDescription: 'Enter the reset code from your email and choose a new password for your Marpdown account.',
  confirmEmailDescription:
    'Enter the confirmation code you received via email to activate your Marpdown account.',
  features: [
    {
      title: 'Live Marp preview',
      description: 'Edit Markdown and preview slides side by side',
    },
    {
      title: 'Asset management',
      description: 'Upload and organize images and files for your deck',
    },
    {
      title: 'Export to PDF and PPTX',
      description: 'Share finished presentations in common formats',
    },
  ],
};
