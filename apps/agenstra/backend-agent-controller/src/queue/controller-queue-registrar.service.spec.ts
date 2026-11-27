import { ControllerQueueRegistrarService } from './controller-queue-registrar.service';
import { RETIRED_CONTROLLER_REPEATABLE_JOBS } from './job-registry';

describe('ControllerQueueRegistrarService', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('removes retired jobs before registering active schedulers', async () => {
    process.env = { ...originalEnv, QUEUE_ROLE: 'scheduler' };

    const retired = RETIRED_CONTROLLER_REPEATABLE_JOBS[0];
    const removeRepeatableByKey = jest.fn().mockResolvedValue(true);
    const queue = {
      getJobSchedulers: jest
        .fn()
        .mockResolvedValue([{ name: retired.name, id: retired.coordinatorJobId, key: 'legacy:old' }]),
      removeRepeatableByKey,
      removeJobScheduler: jest.fn().mockResolvedValue(true),
      upsertJobScheduler: jest.fn().mockResolvedValue({}),
    };
    const service = new ControllerQueueRegistrarService(queue as never);

    await service.onModuleInit();

    expect(removeRepeatableByKey).toHaveBeenCalledWith('legacy:old');
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(retired.coordinatorJobId);
    expect(queue.upsertJobScheduler).toHaveBeenCalled();
  });
});
