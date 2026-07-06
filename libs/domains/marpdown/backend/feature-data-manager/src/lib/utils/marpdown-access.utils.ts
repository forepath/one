import { getUserFromRequest, type RequestWithUser } from '@forepath/identity/backend';

export type { RequestWithUser };

export interface UserInfoFromRequest {
  userId?: string;
  isApiKeyAuth: boolean;
}

export function getMarpdownUserFromRequest(req: RequestWithUser): UserInfoFromRequest {
  const info = getUserFromRequest(req);

  return {
    userId: info.userId,
    isApiKeyAuth: info.isApiKeyAuth,
  };
}
