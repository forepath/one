import type { SocketUserInfo } from '@forepath/identity/backend';

/**
 * Billing REST treats API-key requests as having no end-user id. Mirror that for WebSocket
 * dashboard status so we never stream subscription data to static API key clients.
 */
export function getBillingUserIdFromSocketUser(userInfo: SocketUserInfo | undefined): string | null {
  if (!userInfo) {
    return null;
  }

  if (userInfo.isApiKeyAuth) {
    return null;
  }

  const id = userInfo.userId ?? userInfo.user?.id;

  return id ?? null;
}
