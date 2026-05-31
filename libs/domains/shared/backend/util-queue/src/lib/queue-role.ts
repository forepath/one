export type QueueRole = 'api' | 'scheduler' | 'worker' | 'all';

const VALID_ROLES: readonly QueueRole[] = ['api', 'scheduler', 'worker', 'all'];

export interface ParseQueueRoleEnv {
  NODE_ENV?: string;
  [key: string]: string | undefined;
}

function formatInvalidQueueRoleMessage(raw: string): string {
  return `Invalid QUEUE_ROLE "${raw}"; expected one of: ${VALID_ROLES.join(', ')}`;
}

export function parseQueueRole(raw: string | undefined, env: ParseQueueRoleEnv = process.env): QueueRole {
  if (raw === undefined || raw.trim().length === 0) {
    return 'all';
  }

  const value = raw.trim().toLowerCase();

  if (VALID_ROLES.includes(value as QueueRole)) {
    return value as QueueRole;
  }

  const message = formatInvalidQueueRoleMessage(raw);

  if (env.NODE_ENV === 'production') {
    throw new Error(message);
  }

  console.warn(`[queue-role] ${message}; falling back to "api"`);

  return 'api';
}

export function getQueueRole(): QueueRole {
  return parseQueueRole(process.env.QUEUE_ROLE);
}

export function shouldRunApiHttp(role: QueueRole = getQueueRole()): boolean {
  return role === 'api' || role === 'all';
}

export function shouldRegisterRepeatableJobs(role: QueueRole = getQueueRole()): boolean {
  return role === 'scheduler' || role === 'all';
}

export function shouldRunQueueWorkers(role: QueueRole = getQueueRole()): boolean {
  return role === 'worker' || role === 'all';
}

export function shouldEnableBullBoard(role: QueueRole = getQueueRole()): boolean {
  if (process.env.QUEUE_BULL_BOARD_ENABLED === 'false') {
    return false;
  }

  // Bull Board HTTP is only served on API (or all-in-one) processes
  if (role !== 'api' && role !== 'all') {
    return false;
  }

  if (process.env.QUEUE_BULL_BOARD_ENABLED === 'true') {
    return true;
  }

  return role === 'all';
}

export function shouldRunMigrations(role: QueueRole = getQueueRole()): boolean {
  return role === 'api' || role === 'all';
}
