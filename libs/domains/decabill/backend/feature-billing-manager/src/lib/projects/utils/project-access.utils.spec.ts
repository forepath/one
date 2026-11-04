import { UserRole } from '@forepath/identity/backend';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

import type { ProjectEntity } from '../entities/project.entity';
import type { ProjectMilestoneEntity } from '../entities/project-milestone.entity';
import type { ProjectTicketEntity } from '../entities/project-ticket.entity';
import {
  ensureProjectAdmin,
  ensureProjectComment,
  ensureProjectReadable,
  ensureTicketUnlocked,
  isTicketLockedForNonAdmin,
} from './project-access.utils';

describe('project-access.utils', () => {
  const project = { id: 'p1', userId: 'user-1' } as ProjectEntity;

  it('allows admin to read any project', () => {
    expect(() =>
      ensureProjectReadable({ userId: 'admin-1', userRole: UserRole.ADMIN, isApiKeyAuth: false }, project),
    ).not.toThrow();
  });

  describe('personal access tokens', () => {
    const patAdmin = (scopes: string[]) => ({
      userId: 'admin-1',
      userRole: UserRole.ADMIN,
      isApiKeyAuth: false,
      amr: ['pat'],
      scopes,
    });

    it('denies cross-owner access without an admin scope argument (fail-closed)', () => {
      expect(() => ensureProjectReadable(patAdmin(['tickets:admin']), project)).toThrow(ForbiddenException);
    });

    it("requires the resource admin scope for other users' projects", () => {
      expect(() => ensureProjectReadable(patAdmin(['tickets:read']), project, 'tickets:admin')).toThrow(
        /Missing: tickets:admin/,
      );
      expect(() => ensureProjectReadable(patAdmin(['milestones:admin']), project, 'tickets:admin')).toThrow(
        ForbiddenException,
      );
      expect(() => ensureProjectReadable(patAdmin(['tickets:admin']), project, 'tickets:admin')).not.toThrow();
    });

    it('lets owners pass with any scope', () => {
      expect(() =>
        ensureProjectReadable({ ...patAdmin(['tickets:read']), userId: 'user-1' }, project, 'tickets:admin'),
      ).not.toThrow();
    });

    it('never lets non-admin PATs cross owners, even with an admin scope', () => {
      expect(() =>
        ensureProjectReadable(
          { userId: 'user-2', userRole: UserRole.USER, isApiKeyAuth: false, amr: ['pat'], scopes: ['tickets:admin'] },
          project,
          'tickets:admin',
        ),
      ).toThrow(ForbiddenException);
    });

    it('ensureProjectComment needs tickets:admin on foreign projects', () => {
      expect(() => ensureProjectComment(patAdmin(['tickets:write']), project)).toThrow(/Missing: tickets:admin/);
    });
  });

  it('allows assigned customer to read project', () => {
    expect(() =>
      ensureProjectReadable({ userId: 'user-1', userRole: UserRole.USER, isApiKeyAuth: false }, project),
    ).not.toThrow();
  });

  it('denies other customers', () => {
    expect(() =>
      ensureProjectReadable({ userId: 'user-2', userRole: UserRole.USER, isApiKeyAuth: false }, project),
    ).toThrow(ForbiddenException);
  });

  it('denies API key auth for read', () => {
    expect(() => ensureProjectReadable({ isApiKeyAuth: true }, project)).toThrow(ForbiddenException);
  });

  it('ensureProjectAdmin requires admin', () => {
    expect(() => ensureProjectAdmin({ userId: 'user-1', userRole: UserRole.USER, isApiKeyAuth: false })).toThrow(
      ForbiddenException,
    );
  });

  it('ensureProjectComment allows customer on own project', () => {
    expect(() =>
      ensureProjectComment({ userId: 'user-1', userRole: UserRole.USER, isApiKeyAuth: false }, project),
    ).not.toThrow();
  });

  it('isTicketLockedForNonAdmin when ticket locked', () => {
    const ticket = { locked: true } as ProjectTicketEntity;

    expect(isTicketLockedForNonAdmin(ticket, null)).toBe(true);
  });

  it('isTicketLockedForNonAdmin when milestone locked', () => {
    const ticket = { locked: false } as ProjectTicketEntity;
    const milestone = { lockedAt: new Date() } as ProjectMilestoneEntity;

    expect(isTicketLockedForNonAdmin(ticket, milestone)).toBe(true);
  });

  it('ensureTicketUnlocked throws when ticket locked', () => {
    expect(() => ensureTicketUnlocked({ locked: true } as ProjectTicketEntity)).toThrow(BadRequestException);
  });

  it('ensureTicketUnlocked passes when ticket unlocked', () => {
    expect(() => ensureTicketUnlocked({ locked: false } as ProjectTicketEntity)).not.toThrow();
  });
});
