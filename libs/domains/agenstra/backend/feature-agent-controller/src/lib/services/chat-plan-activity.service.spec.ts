import { ChatPlanActionType, ChatPlanActorType } from '../entities/chat-plan.enums';
import type { ChatPlanActivityEntity } from '../entities/chat-plan-activity.entity';

import { ChatPlanActivityService, chatPlanUserActor } from './chat-plan-activity.service';

describe('ChatPlanActivityService', () => {
  const activityRepo = {
    create: jest.fn((row: unknown) => row),
    save: jest.fn(),
    find: jest.fn(),
  };
  const usersRepository = { findById: jest.fn() };
  let service: ChatPlanActivityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ChatPlanActivityService(activityRepo as never, usersRepository as never);
  });

  it('chatPlanUserActor is human with a user, system without one', () => {
    expect(chatPlanUserActor('u1')).toEqual({ type: ChatPlanActorType.HUMAN, userId: 'u1' });
    expect(chatPlanUserActor(null)).toEqual({ type: ChatPlanActorType.SYSTEM });
  });

  it('append stores the row', async () => {
    activityRepo.save.mockResolvedValue({});

    await service.append('p1', ChatPlanActionType.CONTENT_UPDATED, chatPlanUserActor('u1'), {
      fields: ['planMarkdown'],
    });

    expect(activityRepo.save).toHaveBeenCalledWith({
      planId: 'p1',
      actionType: ChatPlanActionType.CONTENT_UPDATED,
      actorType: ChatPlanActorType.HUMAN,
      actorUserId: 'u1',
      payload: { fields: ['planMarkdown'] },
    });
  });

  it('append never fails the plan operation', async () => {
    activityRepo.save.mockRejectedValue(new Error('db down'));

    await expect(service.append('p1', ChatPlanActionType.EXECUTED, { type: ChatPlanActorType.AI })).resolves.toBe(
      undefined,
    );
  });

  it('list resolves actor e-mails once per user, newest first, bounded', async () => {
    const at = new Date();

    activityRepo.find.mockResolvedValue([
      {
        id: 'a2',
        planId: 'p1',
        occurredAt: at,
        actorType: 'human',
        actorUserId: 'u1',
        actionType: 'EXECUTED',
        payload: {},
      },
      {
        id: 'a1',
        planId: 'p1',
        occurredAt: at,
        actorType: 'human',
        actorUserId: 'u1',
        actionType: 'CREATED',
        payload: {},
      },
      {
        id: 'a0',
        planId: 'p1',
        occurredAt: at,
        actorType: 'ai',
        actorUserId: null,
        actionType: 'DRAFT_UPDATED',
        payload: {},
      },
    ] as unknown as ChatPlanActivityEntity[]);
    usersRepository.findById.mockResolvedValue({ email: 'user@example.com' });

    const rows = await service.list('p1', 1000, -5);

    expect(activityRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { planId: 'p1' },
        order: { occurredAt: 'DESC', id: 'DESC' },
        take: 200,
        skip: 0,
      }),
    );
    expect(usersRepository.findById).toHaveBeenCalledTimes(1);
    expect(rows.map((row) => row.actorEmail)).toEqual(['user@example.com', 'user@example.com', null]);
  });
});
