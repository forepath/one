import {
  afterCommit,
  InitiativeAfterCommitSubscriber,
  registerInitiativeAfterCommitSubscriber,
} from './initiative-after-commit';

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('afterCommit', () => {
  const subscriber = new InitiativeAfterCommitSubscriber();

  function transaction() {
    const queryRunner = { isTransactionActive: true, data: {} as Record<string, unknown> };

    return { em: { queryRunner } as never, queryRunner };
  }

  it('runs queued callbacks only after the outermost commit', async () => {
    const { em, queryRunner } = transaction();
    const callback = jest.fn();

    afterCommit(em, callback);

    // A savepoint release (nested transaction) keeps the queue.
    subscriber.afterTransactionCommit({ queryRunner } as never);
    await flush();
    expect(callback).not.toHaveBeenCalled();

    queryRunner.isTransactionActive = false;
    subscriber.afterTransactionCommit({ queryRunner } as never);
    await flush();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('drops queued callbacks on rollback', async () => {
    const { em, queryRunner } = transaction();
    const callback = jest.fn();

    afterCommit(em, callback);
    queryRunner.isTransactionActive = false;
    subscriber.afterTransactionRollback({ queryRunner } as never);
    subscriber.afterTransactionCommit({ queryRunner } as never);
    await flush();
    expect(callback).not.toHaveBeenCalled();
  });

  it('runs on the next tick outside a transaction and survives failing callbacks', async () => {
    const callback = jest.fn();

    afterCommit(undefined, () => {
      throw new Error('boom');
    });
    afterCommit({ queryRunner: undefined } as never, callback);
    expect(callback).not.toHaveBeenCalled();
    await flush();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('registers the subscriber once', () => {
    const dataSource = { subscribers: [] as unknown[] };

    registerInitiativeAfterCommitSubscriber(dataSource as never);
    registerInitiativeAfterCommitSubscriber(dataSource as never);
    registerInitiativeAfterCommitSubscriber(undefined);
    expect(dataSource.subscribers).toHaveLength(1);
  });
});
