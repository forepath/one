/** Socket.IO event names on the `clients` namespace for chat plan mode. */
export const CLIENT_CHAT_PLAN_EVENTS = {
  createChatPlan: 'createChatPlan',
  refineChatPlan: 'refineChatPlan',
  executeChatPlan: 'executeChatPlan',
  cancelChatPlan: 'cancelChatPlan',
  chatPlanUpsert: 'chatPlanUpsert',
} as const;
