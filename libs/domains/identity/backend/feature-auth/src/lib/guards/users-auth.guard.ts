import {
  getAuthenticationMethod,
  getHttpRequestPath,
  isBullBoardRequestPath,
  IS_PUBLIC_KEY,
} from '@forepath/identity/backend';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

import { UsersRepository } from '../repositories/users.repository';

export interface UsersJwtPayload {
  sub: string;
  email: string;
  roles: string[];
}

@Injectable()
export class UsersAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly usersRepository: UsersRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    if (getAuthenticationMethod() !== 'users') {
      return true;
    }

    // Bull Board uses HTTP Basic auth (QUEUE_BULL_BOARD_*), not JWT
    if (isBullBoardRequestPath(getHttpRequestPath(context))) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    // Pass through when user is already set (e.g. by API key or other auth)
    if (request['user']) {
      return true;
    }

    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Missing or invalid authorization token');
    }

    try {
      const payload = await this.jwtService.verifyAsync<UsersJwtPayload>(token);
      const user = await this.usersRepository.findById(payload.sub);

      if (!user) {
        throw new UnauthorizedException('Session is no longer valid.');
      }

      if (user.lockedAt) {
        throw new UnauthorizedException('This account is locked. Please contact an administrator.');
      }

      request['user'] = {
        id: payload.sub,
        email: payload.email,
        roles: payload.roles ?? ['user'],
      };

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];

    return type === 'Bearer' ? token : undefined;
  }
}
