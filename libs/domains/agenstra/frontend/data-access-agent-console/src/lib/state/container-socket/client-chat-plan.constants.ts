/** Controller → clients namespace: chat plan card upsert / hydrate. */
export const CLIENT_CHAT_PLAN_SOCKET_EVENT = 'chatPlanUpsert' as const;

/** Client → controller (clients namespace) chat plan commands. */
export const CLIENT_CHAT_PLAN_EVENTS = {
  createChatPlan: 'createChatPlan',
  refineChatPlan: 'refineChatPlan',
  executeChatPlan: 'executeChatPlan',
  cancelChatPlan: 'cancelChatPlan',
  chatPlanUpsert: CLIENT_CHAT_PLAN_SOCKET_EVENT,
} as const;
