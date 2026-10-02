/**
 * Shared Nginx compose fragments for provisioned product stacks (TLS terminator in front of app containers).
 */
import type { CloudInitComposeServiceParams } from './compose-service.utils';

export const NGINX_COMPOSE_IMAGE = 'nginx:alpine';

export interface NginxComposeServiceParams extends CloudInitComposeServiceParams {
  stackDir: string;
  httpPort: number | string;
  httpsPort: number | string;
  dependsOn: string[];
}

export function buildNginxComposeService(params: NginxComposeServiceParams): string {
  const httpPort = String(params.httpPort);
  const httpsPort = String(params.httpsPort);
  const dependsOn = params.dependsOn.map((service) => `      - ${service}`).join('\n');

  return `  nginx:
    image: ${NGINX_COMPOSE_IMAGE}
    container_name: ${params.containerName}
    ports:
      - '${httpPort}:${httpPort}'
      - '${httpsPort}:${httpsPort}'
    depends_on:
${dependsOn}
    volumes:
      - ${params.stackDir}/sites-enabled:/etc/nginx/conf.d:ro
      - ${params.stackDir}/ssl:/etc/nginx/ssl:ro
      - ${params.stackDir}/certbot-webroot:/var/www/certbot:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    networks:
      - ${params.network}
    restart: unless-stopped`;
}
