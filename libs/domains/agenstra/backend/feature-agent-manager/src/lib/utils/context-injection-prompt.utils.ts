import { ContainerType } from '../entities/agent.entity';
import { EnvironmentContextReference } from '../types/context-injection.types';

export function isNonGenericContainerType(type: ContainerType | string | undefined): type is ContainerType {
  return type !== undefined && type !== ContainerType.GENERIC && type !== 'generic';
}

export function formatWorkspaceContextLine(containerType?: ContainerType): string {
  const base = '- Shared workspace context is mounted at /opt/workspace (read-only).';

  if (!isNonGenericContainerType(containerType)) {
    return base;
  }

  return `${base} Repository type: ${containerType}.`;
}

export function formatEnvironmentContextLine(
  environmentIds: string[],
  references: EnvironmentContextReference[],
): string {
  if (environmentIds.length === 0) {
    return '';
  }

  const typeById = new Map(references.map((ref) => [ref.id, ref.containerType]));
  const formattedIds = environmentIds.map((id) => {
    const containerType = typeById.get(id);

    if (!isNonGenericContainerType(containerType)) {
      return id;
    }

    return `${id} (repository type: ${containerType})`;
  });

  return `- Relevant environment context: ${formattedIds.join(', ')}.`;
}
