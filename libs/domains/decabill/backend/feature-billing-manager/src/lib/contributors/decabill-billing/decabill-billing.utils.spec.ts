import {
  DECABILL_BILLING_STACK_DIR,
  buildDecabillBillingCloudInitConfigFromRequest,
  buildDecabillBillingCloudInitUserData,
  buildDecabillBillingUpdateCommand,
} from './decabill-billing.utils';

describe('decabill-billing.utils', () => {
  describe('buildDecabillBillingCloudInitConfigFromRequest', () => {
    it('sets host.fqdn, cors, and billingFrontendUrl from hostname and baseDomain', () => {
      const config = buildDecabillBillingCloudInitConfigFromRequest(
        { authenticationMethod: 'users' },
        'awesome-armadillo-abc12',
        'spirde.com',
      );

      expect(config.host.hostname).toBe('awesome-armadillo-abc12');
      expect(config.host.fqdn).toBe('awesome-armadillo-abc12.spirde.com');
      expect(config.backend.cors.origin).toBe('https://awesome-armadillo-abc12.spirde.com');
      expect(config.backend.billingFrontendUrl).toBe('https://awesome-armadillo-abc12.spirde.com');
      expect(config.backend.port).toBe(3200);
      expect(config.frontend.port).toBe(4500);
      expect(config.backend.websocketNamespace).toBe('socket/billing');
    });

    it('generates random encryptionKey, jwtSecret, fileSigningSecret, and database password', () => {
      const config1 = buildDecabillBillingCloudInitConfigFromRequest({}, 'host1');
      const config2 = buildDecabillBillingCloudInitConfigFromRequest({}, 'host2');

      expect(config1.backend.encryption.encryptionKey).toBeTruthy();
      expect(config1.backend.encryption.jwtSecret).toBeTruthy();
      expect(config1.backend.encryption.fileSigningSecret).toBeTruthy();
      expect(config1.backend.database?.password).toBeTruthy();
      expect(config1.backend.encryption.encryptionKey).not.toBe(config2.backend.encryption.encryptionKey);
      expect(config1.backend.encryption.fileSigningSecret).not.toBe(config2.backend.encryption.fileSigningSecret);
      expect(config1.backend.database?.password).not.toBe(config2.backend.database?.password);
      expect(config1.backend.rateLimit.enabled).toBe(true);
    });

    it('sets provisioning tokens from effectiveConfig when provided', () => {
      const config = buildDecabillBillingCloudInitConfigFromRequest(
        {
          hetznerApiToken: 'secret-hetzner',
          digitaloceanApiToken: 'secret-do',
        },
        'host1',
      );

      expect(config.backend.provisioning?.hetznerApiToken).toBe('secret-hetzner');
      expect(config.backend.provisioning?.digitaloceanApiToken).toBe('secret-do');
    });

    it('defaults ssh.publicKey to empty string when not provided', () => {
      const config = buildDecabillBillingCloudInitConfigFromRequest({}, 'host1');

      expect(config.ssh.publicKey).toBe('');
    });
  });

  describe('buildDecabillBillingCloudInitUserData', () => {
    it('returns base64-encoded user data that decodes to a bash script with Decabill images', () => {
      const config = buildDecabillBillingCloudInitConfigFromRequest(
        { authenticationMethod: 'users', sshPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIexample' },
        'host1',
        'example.com',
      );
      const encoded = buildDecabillBillingCloudInitUserData(config);
      const script = Buffer.from(encoded, 'base64').toString('utf8');

      expect(script).toContain('#!/bin/bash');
      expect(script).toContain('ghcr.io/forepath/decabill-billing-api:latest');
      expect(script).toContain('ghcr.io/forepath/decabill-billing-console-server:latest');
      expect(script).toContain('postgres:16-alpine');
      expect(script).toContain('redis:7-alpine');
      expect(script).toContain('nginx:alpine');
      expect(script).toContain('opensearchproject/opensearch:2.19.1');
      expect(script).toContain('container_name: decabill-billing-opensearch');
      expect(script).toContain('OPENSEARCH_HOST: opensearch');
      expect(script).toContain("OPENSEARCH_NODE: 'http://opensearch:9200'");
      expect(script).toContain('OPENSEARCH_INDEX_PREFIX: decabill');
      expect(script).toContain('SEARCH_REINDEX_INTERVAL: 15m');
      expect(script).toContain('vm.max_map_count=262144');
      expect(script).not.toContain('9200:9200');
      expect(script).toContain(DECABILL_BILLING_STACK_DIR);
      expect(script).toContain('REDIS_KEY_PREFIX: decabill-billing');
      expect(script).toContain('BILLING_FRONTEND_URL:');
      expect(script).toContain('FILE_STORAGE_PROVIDER: local');
      expect(script).toContain("FILE_STORAGE_ROOT: '/data'");
      expect(script).toContain('FILE_STORAGE_LAYOUT_MIGRATION_ENABLED: true');
      expect(script).toContain('FILE_STORAGE_LAYOUT_DUAL_READ_ENABLED: true');
      expect(script).toContain(`BILLING_FILE_SIGNING_SECRET: ${config.backend.encryption.fileSigningSecret}`);
      expect(script).toContain('location /socket/');
      expect(script).toContain('location /socket.io/');
      expect(script).toContain("WEBSOCKET_NAMESPACE: 'socket/billing'");
      expect(script).not.toContain('WEBSOCKET_PORT');
      expect(script).toContain('"billing"');
      expect(script).toContain('"websocket":"https://host1.example.com/socket/billing"');
      expect(script).toContain('"restApi":"https://host1.example.com:443/api"');
      expect(script).toContain('"authentication":{"config"');
      expect(script).not.toContain('"restApiUrl"');
      expect(script).not.toContain('"websocketUrl"');
    });
  });

  describe('buildDecabillBillingUpdateCommand', () => {
    it('targets the Decabill billing stack directory', () => {
      const command = buildDecabillBillingUpdateCommand();

      expect(command).toContain(`cd ${DECABILL_BILLING_STACK_DIR}`);
      expect(command).toContain('docker compose up -d --pull=always');
      expect(command).toContain('/var/log/decabill-billing-update.log');
    });
  });
});
