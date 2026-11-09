import { Logger } from '@nestjs/common';
import type {
  DataSource,
  EntityManager,
  EntitySubscriberInterface,
  QueryRunner,
  TransactionCommitEvent,
  TransactionRollbackEvent,
} from 'typeorm';

const AFTER_COMMIT_KEY = '__initiativeAfterCommit';
const logger = new Logger('InitiativeAfterCommit');

type Callback = () => void;

function queue(runner: QueryRunner): Callback[] | undefined {
  return (runner.data as Record<string, Callback[] | undefined> | undefined)?.[AFTER_COMMIT_KEY];
}

function run(callback: Callback): void {
  try {
    callback();
  } catch (error) {
    logger.warn(`After-commit callback failed: ${(error as Error).message}`);
  }
}

/**
 * Runs `callback` (live board emits, webhooks) once the transaction of `em` committed, and never when it rolls back.
 * Outside a transaction it runs on the next tick, after the current write resolved.
 */
export function afterCommit(em: EntityManager | undefined, callback: Callback): void {
  const runner = em?.queryRunner;

  if (runner?.isTransactionActive) {
    const data = (runner.data ??= {}) as Record<string, Callback[] | undefined>;

    (data[AFTER_COMMIT_KEY] ??= []).push(callback);

    return;
  }

  setImmediate(() => run(callback));
}

/** Flushes / drops the queued callbacks of a transaction (registered once on the DataSource). */
export class InitiativeAfterCommitSubscriber implements EntitySubscriberInterface {
  afterTransactionCommit(event: TransactionCommitEvent): void {
    const callbacks = queue(event.queryRunner);

    // Savepoint releases (nested transactions) also broadcast; only the outermost COMMIT makes the rows visible.
    if (!callbacks?.length || event.queryRunner.isTransactionActive) {
      return;
    }

    delete (event.queryRunner.data as Record<string, unknown>)[AFTER_COMMIT_KEY];
    setImmediate(() => callbacks.forEach(run));
  }

  afterTransactionRollback(event: TransactionRollbackEvent): void {
    if (queue(event.queryRunner) && !event.queryRunner.isTransactionActive) {
      delete (event.queryRunner.data as Record<string, unknown>)[AFTER_COMMIT_KEY];
    }
  }
}

export function registerInitiativeAfterCommitSubscriber(dataSource: DataSource | undefined): void {
  const subscribers = dataSource?.subscribers;

  if (subscribers && !subscribers.some((subscriber) => subscriber instanceof InitiativeAfterCommitSubscriber)) {
    subscribers.push(new InitiativeAfterCommitSubscriber());
  }
}
