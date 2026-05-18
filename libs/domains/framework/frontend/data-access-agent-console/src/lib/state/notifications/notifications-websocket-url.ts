import type { Environment } from '@forepath/framework/frontend/util-configuration';

export function resolveStatusWebsocketUrl(environment: Environment): string | null {
  const explicit = environment.controller.statusWebsocketUrl?.trim();

  if (explicit) {
    return explicit;
  }

  const base = environment.controller.websocketUrl?.trim();

  if (!base) {
    return null;
  }

  if (base.endsWith('/clients')) {
    return `${base.slice(0, -'/clients'.length)}/status`;
  }

  try {
    const u = new URL(base);

    return `${u.protocol}//${u.host}/status`;
  } catch {
    return `${base.replace(/\/$/, '')}/status`;
  }
}
