import { ControllerQueueRegistrarService } from './controller-queue-registrar.service';
import { RETIRED_CONTROLLER_REPEATABLE_JOBS } from './job-registry';

describe('ControllerQueueRegistrarService', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('removes retired repeatables before registering active ones', async () => {
    process.env = { ...originalEnv, QUEUE_ROLE: 'scheduler' };

    const retired = RETIRED_CONTROLLER_REPEATABLE_JOBS[0];
    const removeRepeatableByKey = jest.fn().mockResolvedValue(true);
    const queue = {
      getRepeatableJobs: jest
        .fn()
        .mockResolvedValue([{ name: retired.name, id: retired.coordinatorJobId, key: 'repeat:old' }]),
      removeRepeatableByKey,
      add: jest.fn().mockResolvedValue({}),
    };
    const service = new ControllerQueueRegistrarService(queue as never);

    await service.onModuleInit();

    expect(removeRepeatableByKey).toHaveBeenCalledWith('repeat:old');
    expect(queue.add).toHaveBeenCalled();
  });
});
