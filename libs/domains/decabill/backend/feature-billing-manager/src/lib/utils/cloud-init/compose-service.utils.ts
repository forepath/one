/**
 * Shared Docker Compose layout fragments used by provisioned product stacks.
 */
export interface CloudInitComposeServiceParams {
  containerName: string;
  network: string;
}

export function buildHealthyDependsOn(serviceName: string): string {
  return `      ${serviceName}:
        condition: service_healthy`;
}

export function buildComposeNamedVolumes(names: string[]): string {
  return `volumes:
${names.map((name) => `  ${name}:`).join('\n')}`;
}

export function buildComposeBridgeNetwork(name: string): string {
  return `networks:
  ${name}:
    name: ${name}
    driver: bridge`;
}
