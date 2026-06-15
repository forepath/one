import { ContainerType } from '../entities/agent.entity';

import {
  formatEnvironmentContextLine,
  formatWorkspaceContextLine,
  isNonGenericContainerType,
} from './context-injection-prompt.utils';

describe('context-injection-prompt.utils', () => {
  describe('isNonGenericContainerType', () => {
    it('returns false for generic and undefined', () => {
      expect(isNonGenericContainerType(undefined)).toBe(false);
      expect(isNonGenericContainerType(ContainerType.GENERIC)).toBe(false);
      expect(isNonGenericContainerType('generic')).toBe(false);
    });

    it('returns true for non-generic types', () => {
      expect(isNonGenericContainerType(ContainerType.DOCKER)).toBe(true);
      expect(isNonGenericContainerType(ContainerType.TERRAFORM)).toBe(true);
      expect(isNonGenericContainerType(ContainerType.KUBERNETES)).toBe(true);
    });
  });

  describe('formatWorkspaceContextLine', () => {
    it('returns base line without type for generic or omitted type', () => {
      expect(formatWorkspaceContextLine()).toBe('- Shared workspace context is mounted at /opt/workspace (read-only).');
      expect(formatWorkspaceContextLine(ContainerType.GENERIC)).toBe(
        '- Shared workspace context is mounted at /opt/workspace (read-only).',
      );
    });

    it('appends repository type for non-generic types', () => {
      expect(formatWorkspaceContextLine(ContainerType.DOCKER)).toBe(
        '- Shared workspace context is mounted at /opt/workspace (read-only). Repository type: docker.',
      );
      expect(formatWorkspaceContextLine(ContainerType.TERRAFORM)).toContain('Repository type: terraform.');
      expect(formatWorkspaceContextLine(ContainerType.KUBERNETES)).toContain('Repository type: kubernetes.');
    });
  });

  describe('formatEnvironmentContextLine', () => {
    it('returns empty string when no environment ids', () => {
      expect(formatEnvironmentContextLine([], [])).toBe('');
    });

    it('lists ids without type annotation when all generic', () => {
      expect(formatEnvironmentContextLine(['env-1', 'env-2'], [])).toBe(
        '- Relevant environment context: env-1, env-2.',
      );
    });

    it('annotates non-generic environments while leaving generic ids plain', () => {
      const line = formatEnvironmentContextLine(
        ['env-1', 'env-2', 'env-3'],
        [{ id: 'env-2', containerType: ContainerType.TERRAFORM }],
      );

      expect(line).toBe('- Relevant environment context: env-1, env-2 (repository type: terraform), env-3.');
    });

    it('preserves environment id ordering', () => {
      const line = formatEnvironmentContextLine(
        ['b', 'a'],
        [
          { id: 'a', containerType: ContainerType.DOCKER },
          { id: 'b', containerType: ContainerType.KUBERNETES },
        ],
      );

      expect(line).toBe(
        '- Relevant environment context: b (repository type: kubernetes), a (repository type: docker).',
      );
    });
  });
});
