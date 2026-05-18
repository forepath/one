import { UserRole } from '@forepath/identity/backend';
import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class AgentConsoleStatusRealtimeService {
  private readonly logger = new Logger(AgentConsoleStatusRealtimeService.name);
  private server: Server | null = null;
  private readonly socketsByUserId = new Map<string, Set<string>>();
  private readonly socketIdToUserId = new Map<string, string>();
  private readonly userRoleByUserId = new Map<string, UserRole>();

  attachServer(server: Server): void {
    this.server = server;
  }

  registerSocket(userId: string, socketId: string, userRole: UserRole = UserRole.USER): void {
    let set = this.socketsByUserId.get(userId);

    if (!set) {
      set = new Set();
      this.socketsByUserId.set(userId, set);
    }

    set.add(socketId);
    this.socketIdToUserId.set(socketId, userId);
    this.userRoleByUserId.set(userId, userRole);
  }

  getConnectedUserIds(): string[] {
    return [...this.socketsByUserId.keys()];
  }

  getUserRole(userId: string): UserRole | undefined {
    return this.userRoleByUserId.get(userId);
  }

  getUserIdForSocket(socketId: string): string | undefined {
    return this.socketIdToUserId.get(socketId);
  }

  unregisterSocket(socketId: string): void {
    const userId = this.socketIdToUserId.get(socketId);

    if (!userId) {
      return;
    }

    const set = this.socketsByUserId.get(userId);

    if (set) {
      set.delete(socketId);

      if (set.size === 0) {
        this.socketsByUserId.delete(userId);
        this.userRoleByUserId.delete(userId);
      }
    }

    this.socketIdToUserId.delete(socketId);
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    if (!this.server) {
      return;
    }

    const socketIds = this.socketsByUserId.get(userId);

    if (!socketIds?.size) {
      return;
    }

    for (const socketId of socketIds) {
      this.server.to(socketId).emit(event, payload);
    }
  }

  emitToUsers(userIds: string[], event: string, payload: unknown): void {
    for (const userId of userIds) {
      this.emitToUser(userId, event, payload);
    }
  }
}
