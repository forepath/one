import type { AuthMarketing } from '@forepath/shared/frontend/util-configuration';

/** Brand copy for the shared auth screens. Every feature line maps to a decided Loadweaver capability. */
export const loadweaverAuthMarketing: AuthMarketing = {
  loginDescription:
    'Resilient clusters from a handful of servers. Sign in to manage your sites, nodes, deployments and policies from one console.',
  registerDescription:
    'Join Loadweaver to run resilient clusters on infrastructure you control. After registration, you will receive an email to confirm your account before you can log in.',
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
      title: 'Encrypted network between your sites',
      description: 'Nodes connect across sites over WireGuard, and only where a policy allows it',
    },
    {
      title: 'Shared storage on every node',
      description: 'Replicated volumes keep stateful workloads available when a node goes down',
    },
    {
      title: 'Ingress that fails over on its own',
      description: 'Failover IPs, BGP or DNS failover move traffic to a healthy node automatically',
    },
    {
      title: 'Plan before you apply',
      description: 'Every change is a reviewed plan with a failure analysis, applied with locks and rollback',
    },
  ],
};
