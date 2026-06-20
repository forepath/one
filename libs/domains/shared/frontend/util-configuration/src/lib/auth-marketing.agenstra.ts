import { AuthMarketing } from './auth-marketing.interface';

export const agenstraAuthMarketing: AuthMarketing = {
  loginDescription:
    'Centralized control for distributed AI agent infrastructure. Manage multiple agent-manager instances, interact with agents in real-time, and edit code directly in their containers - all from one powerful dashboard.',
  registerDescription:
    'Join Agenstra to manage your AI agent infrastructure. After registration, you will receive an email to confirm your account before you can log in.',
  requestPasswordResetDescription:
    'Enter your email address and we will send you a link to reset your password. If an account exists for that email, you will receive instructions shortly.',
  resetPasswordConfirmationDescription:
    'If an account exists for the email you entered, you will receive a password reset code. Enter the code below and choose a new password.',
  resetPasswordDescription:
    'Enter the reset code you received via email and choose a new password. The code is typically sent when you request a password reset.',
  confirmEmailDescription:
    'Enter the 6-character confirmation code you received via email (letters and numbers). You can paste the code or type it in the fields below.',
  features: [
    {
      title: 'Distributed Agent Management',
      description: 'Connect to and manage multiple remote agent-manager services from a single console',
    },
    {
      title: 'Real-time AI Chat',
      description: 'WebSocket-based bidirectional communication with AI agents and instant responses',
    },
    {
      title: 'Integrated Code Editor',
      description:
        'Edit files directly in agent containers with Monaco Editor - read, write, and manage code in real-time',
    },
    {
      title: 'Container Integration',
      description: 'Docker-based agent execution with live log streaming and file system operations',
    },
  ],
};
