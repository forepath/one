import { ChatDirection, StatisticsChatIoEntity, StatisticsInteractionKind } from './statistics-chat-io.entity';

describe('StatisticsChatIoEntity', () => {
  it('should create an instance', () => {
    const entity = new StatisticsChatIoEntity();

    expect(entity).toBeDefined();
  });

  it('should have all required properties', () => {
    const entity = new StatisticsChatIoEntity();

    entity.id = 'chat-io-uuid';
    entity.statisticsClientId = 'stats-client-uuid';
    entity.direction = ChatDirection.INPUT;
    entity.interactionKind = StatisticsInteractionKind.CHAT;
    entity.wordCount = 10;
    entity.charCount = 50;
    entity.occurredAt = new Date();

    expect(entity.id).toBe('chat-io-uuid');
    expect(entity.statisticsClientId).toBe('stats-client-uuid');
    expect(entity.direction).toBe(ChatDirection.INPUT);
    expect(entity.interactionKind).toBe(StatisticsInteractionKind.CHAT);
    expect(entity.wordCount).toBe(10);
    expect(entity.charCount).toBe(50);
    expect(entity.occurredAt).toBeInstanceOf(Date);
  });

  it('should allow optional statisticsAgentId and statisticsUserId', () => {
    const entity = new StatisticsChatIoEntity();

    entity.statisticsAgentId = undefined;
    entity.statisticsUserId = undefined;

    expect(entity.statisticsAgentId).toBeUndefined();
    expect(entity.statisticsUserId).toBeUndefined();
  });

  it('should support INPUT direction', () => {
    const entity = new StatisticsChatIoEntity();

    entity.direction = ChatDirection.INPUT;
    expect(entity.direction).toBe(ChatDirection.INPUT);
    expect(entity.direction).toBe('input');
  });

  it('should support OUTPUT direction', () => {
    const entity = new StatisticsChatIoEntity();

    entity.direction = ChatDirection.OUTPUT;
    expect(entity.direction).toBe(ChatDirection.OUTPUT);
    expect(entity.direction).toBe('output');
  });

  it('should support prompt enhancement and ticket body generation interaction kinds', () => {
    const enhancement = new StatisticsChatIoEntity();

    enhancement.interactionKind = StatisticsInteractionKind.PROMPT_ENHANCEMENT;
    expect(enhancement.interactionKind).toBe('prompt_enhancement');

    const ticketBody = new StatisticsChatIoEntity();

    ticketBody.interactionKind = StatisticsInteractionKind.TICKET_BODY_GENERATION;
    expect(ticketBody.interactionKind).toBe('ticket_body_generation');
  });

  it('should support autonomous ticket run interaction kinds', () => {
    const run = new StatisticsChatIoEntity();

    run.interactionKind = StatisticsInteractionKind.AUTONOMOUS_TICKET_RUN;
    expect(run.interactionKind).toBe('autonomous_ticket_run');

    const turn = new StatisticsChatIoEntity();

    turn.interactionKind = StatisticsInteractionKind.AUTONOMOUS_TICKET_RUN_TURN;
    expect(turn.interactionKind).toBe('autonomous_ticket_run_turn');

    const commitMsg = new StatisticsChatIoEntity();

    commitMsg.interactionKind = StatisticsInteractionKind.AUTONOMOUS_TICKET_COMMIT_MESSAGE;
    expect(commitMsg.interactionKind).toBe('autonomous_ticket_commit_message');
  });
});
