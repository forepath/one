export type QueueRole = 'api' | 'scheduler' | 'worker' | 'all';

const VALID_ROLES: readonly QueueRole[] = ['api', 'scheduler', 'worker', 'all'];

export function parseQueueRole(raw: string | undefined): QueueRole {
  const value = (raw ?? 'all').trim().toLowerCase();

  if (VALID_ROLES.includes(value as QueueRole)) {
    return value as QueueRole;
  }

  return 'all';
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

  if (process.env.QUEUE_BULL_BOARD_ENABLED === 'true') {
    return true;
  }

  return role === 'scheduler' || role === 'all';
}

export function shouldRunMigrations(role: QueueRole = getQueueRole()): boolean {
  return role === 'api' || role === 'all';
}
