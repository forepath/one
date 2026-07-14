import {
  ClientUserEntity,
  ClientUserRole,
  IDENTITY_NOTIFICATION_PUBLISHER,
  IDENTITY_STATISTICS_SERVICE,
  IIdentityNotificationPublisher,
  IIdentityStatisticsService,
  UserRole,
} from '@forepath/identity/backend';
import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';

import { AddClientUserDto } from '../dto/add-client-user.dto';
import { ClientUserResponseDto } from '../dto/client-user-response.dto';
import { ClientUsersRepository } from '../repositories/client-users.repository';
import { UsersRepository } from '../repositories/users.repository';

/**
 * Service for managing client-user relationships.
 * Handles adding and removing users from clients with role-based access control.
 */
@Injectable()
export class ClientUsersService {
  constructor(
    private readonly clientUsersRepository: ClientUsersRepository,
    private readonly usersRepository: UsersRepository,
    @Optional()
    @Inject(IDENTITY_STATISTICS_SERVICE)
    private readonly statisticsService: IIdentityStatisticsService | null,
    @Optional()
    @Inject(IDENTITY_NOTIFICATION_PUBLISHER)
    private readonly notificationPublisher: IIdentityNotificationPublisher | null,
  ) {}

  /**
   * Add a user to a client by email address.
   * @param clientId - The UUID of the client
   * @param addClientUserDto - Data transfer object containing email and role
   * @param requestingUserId - The UUID of the user making the request
   * @param requestingUserRole - The role of the user making the request (from users table)
   * @param isClientCreator - Whether the requesting user is the creator of the client
   * @param requestingClientUserRole - The role of the requesting user for this client (if exists)
   * @returns The created client-user relationship
   * @throws BadRequestException if user not found, relationship already exists, or permission denied
   */
  async addUserToClient(
    clientId: string,
    addClientUserDto: AddClientUserDto,
    requestingUserId: string,
    requestingUserRole: UserRole,
    isClientCreator: boolean,
    requestingClientUserRole?: ClientUserRole,
  ): Promise<ClientUserResponseDto> {
    // Find user by email
    const user = await this.usersRepository.findByEmail(addClientUserDto.email);

    if (!user) {
      throw new BadRequestException(`User with email '${addClientUserDto.email}' not found`);
    }

    // Check if relationship already exists
    const existingRelationship = await this.clientUsersRepository.findByUserAndClient(user.id, clientId);

    if (existingRelationship) {
      throw new BadRequestException(`User '${addClientUserDto.email}' is already associated with this client`);
    }

    // Permission checks:
    // - Global admins can add any role
    // - Client creators can add any role
    // - Client admins can only add 'user' role
    // - Client users cannot add anyone
    if (requestingUserRole === UserRole.ADMIN || isClientCreator) {
      // Global admin or creator: can add any role
    } else if (requestingClientUserRole === ClientUserRole.ADMIN) {
      // Client admin: can only add 'user' role
      if (addClientUserDto.role !== ClientUserRole.USER) {
        throw new BadRequestException('Client admins can only add users with "user" role');
      }
    } else {
      // Client user or no relationship: cannot add anyone
      throw new BadRequestException('You do not have permission to add users to this client');
    }

    // Create the relationship
    const clientUser = await this.clientUsersRepository.create({
      userId: user.id,
      clientId,
      role: addClientUserDto.role,
    });

    this.statisticsService
      ?.recordEntityCreated(
        'client_user',
        clientUser.id,
        {
          clientId,
          userId: user.id,
          role: addClientUserDto.role,
        },
        requestingUserId,
      )
      .catch(() => {
        /* fire and forget */
      });
    this.notificationPublisher?.publishClientUserCreated(
      {
        id: clientUser.id,
        clientId,
        userId: user.id,
        email: user.email,
        role: addClientUserDto.role,
      },
      clientId,
    );

    return this.mapToResponseDto(clientUser, user.email);
  }

  /**
   * Remove a user from a client.
   * @param clientId - The UUID of the client
   * @param relationshipId - The UUID of the client-user relationship to remove
   * @param requestingUserId - The UUID of the user making the request
   * @param requestingUserRole - The role of the user making the request (from users table)
   * @param isClientCreator - Whether the requesting user is the creator of the client
   * @param requestingClientUserRole - The role of the requesting user for this client (if exists)
   * @throws BadRequestException if relationship not found, permission denied, or trying to remove creator
   */
  async removeUserFromClient(
    clientId: string,
    relationshipId: string,
    requestingUserId: string,
    requestingUserRole: UserRole,
    isClientCreator: boolean,
    requestingClientUserRole?: ClientUserRole,
  ): Promise<void> {
    // Find the relationship
    const relationship = await this.clientUsersRepository.findByIdOrThrow(relationshipId);

    // Verify it belongs to the specified client
    if (relationship.clientId !== clientId) {
      throw new BadRequestException('Relationship does not belong to the specified client');
    }

    // Permission checks:
    // - Global admins can remove anyone
    // - Client creators can remove anyone
    // - Client admins can remove users (but not other admins)
    // - Client users cannot remove anyone
    if (requestingUserRole === UserRole.ADMIN || isClientCreator) {
      // Global admin or creator: can remove anyone
    } else if (requestingClientUserRole === ClientUserRole.ADMIN) {
      // Client admin: can only remove users (not other admins)
      if (relationship.role === ClientUserRole.ADMIN) {
        throw new BadRequestException('Client admins cannot remove other admins');
      }
    } else {
      // Client user or no relationship: cannot remove anyone
      throw new BadRequestException('You do not have permission to remove users from this client');
    }

    this.statisticsService?.recordEntityDeleted('client_user', relationshipId, requestingUserId).catch(() => {
      /* fire and forget */
    });
    this.notificationPublisher?.publishClientUserDeleted(
      {
        id: relationship.id,
        clientId: relationship.clientId,
        userId: relationship.userId,
        role: relationship.role,
      },
      clientId,
    );

    // Delete the relationship
    await this.clientUsersRepository.delete(relationshipId);
  }

  /**
   * Get all users associated with a client.
   * @param clientId - The UUID of the client
   * @returns Array of client-user relationships
   */
  async getClientUsers(clientId: string): Promise<ClientUserResponseDto[]> {
    const clientUsers = await this.clientUsersRepository.findByClientId(clientId);

    return Promise.all(
      clientUsers.map(async (cu) => {
        const user = cu.user || (await this.usersRepository.findById(cu.userId));

        return this.mapToResponseDto(cu, user?.email);
      }),
    );
  }

  /**
   * Map client-user entity to response DTO.
   * @param clientUser - The client-user entity to map
   * @param userEmail - Optional email of the user
   * @returns The client-user response DTO
   */
  private mapToResponseDto(clientUser: ClientUserEntity, userEmail?: string): ClientUserResponseDto {
    return {
      id: clientUser.id,
      userId: clientUser.userId,
      clientId: clientUser.clientId,
      role: clientUser.role,
      userEmail,
      createdAt: clientUser.createdAt,
      updatedAt: clientUser.updatedAt,
    };
  }
}
