import { NGINX_COMPOSE_IMAGE, buildNginxComposeService } from './nginx-compose.utils';

describe('nginx-compose.utils', () => {
  describe('buildNginxComposeService', () => {
    it('publishes proxy ports and mounts certbot paths from the stack directory', () => {
      const yaml = buildNginxComposeService({
        containerName: 'decabill-billing-nginx',
        network: 'decabill-billing-network',
        stackDir: '/opt/decabill-billing',
        httpPort: 80,
        httpsPort: 443,
        dependsOn: ['frontend-billing-console-server', 'backend-billing-manager'],
      });

      expect(yaml).toContain(`image: ${NGINX_COMPOSE_IMAGE}`);
      expect(yaml).toContain('container_name: decabill-billing-nginx');
      expect(yaml).toContain("'80:80'");
      expect(yaml).toContain("'443:443'");
      expect(yaml).not.toContain('8443');
      expect(yaml).toContain('- frontend-billing-console-server');
      expect(yaml).toContain('- backend-billing-manager');
      expect(yaml).toContain('/opt/decabill-billing/sites-enabled:/etc/nginx/conf.d:ro');
      expect(yaml).toContain('/etc/letsencrypt:/etc/letsencrypt:ro');
    });
  });
});
