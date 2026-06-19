import { AuthMarketing } from './auth-marketing.interface';

export const forepathAuthMarketing: AuthMarketing = {
  loginDescription:
    'Access your Forepath workspace for projects, deliverables, and client collaboration in one secure portal.',
  registerDescription:
    'Join Forepath to collaborate on your projects and services. After registration, you will receive an email to confirm your account before you can log in.',
  requestPasswordResetDescription:
    'Enter your email address and we will send you instructions to reset your Forepath account password. If an account exists for that email, you will receive them shortly.',
  resetPasswordConfirmationDescription:
    'If an account exists for the email you entered, you will receive a password reset code. Enter the code below and choose a new password for your Forepath account.',
  resetPasswordDescription:
    'Enter the reset code you received via email and choose a new password for your Forepath account.',
  confirmEmailDescription:
    'Enter the 6-character confirmation code you received via email (letters and numbers). You can paste the code or type it in the fields below.',
  features: [
    {
      title: 'Project Visibility',
      description: 'Follow active engagements, milestones, and deliverables in one place',
    },
    {
      title: 'Secure Collaboration',
      description: 'Share documents and updates with your Forepath team safely',
    },
    {
      title: 'Service Management',
      description: 'Keep account details, contacts, and billing information organized',
    },
    {
      title: 'Direct Communication',
      description: 'Reach the right Forepath contacts when you need support or guidance',
    },
  ],
};
