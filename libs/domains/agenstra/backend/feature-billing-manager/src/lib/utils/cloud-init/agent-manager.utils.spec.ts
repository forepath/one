import {
  buildAgentManagerCloudInitConfigFromRequest,
  buildAgentManagerCloudInitUserData,
  buildAgentManagerUpdateCommand,
  AgentManagerCloudInitConfig,
} from './agent-manager.utils';

describe('agent-manager.utils', () => {
  describe('buildAgentManagerCloudInitConfigFromRequest', () => {
    it('sets host.fqdn and defaults cors.origin to *', () => {
      const config = buildAgentManagerCloudInitConfigFromRequest(
        { authenticationMethod: 'api-key' },
        'awesome-armadillo-abc12',
        'spirde.com',
      );

      expect(config.host.hostname).toBe('awesome-armadillo-abc12');
      expect(config.host.fqdn).toBe('awesome-armadillo-abc12.spirde.com');
      expect(config.backend.cors.origin).toBe('*');
    });

    it('defaults baseDomain to spirde.com when not provided', () => {
      const config = buildAgentManagerCloudInitConfigFromRequest({ authenticationMethod: 'api-key' }, 'foo');

      expect(config.host.fqdn).toBe('foo.spirde.com');
    });

    it('coerces authenticationMethod users to api-key', () => {
      const config = buildAgentManagerCloudInitConfigFromRequest({ authenticationMethod: 'users' }, 'host1');

      expect(config.backend.authentication.authenticationMethod).toBe('api-key');
    });

    it('keeps authenticationMethod api-key and keycloak', () => {
      const configApiKey = buildAgentManagerCloudInitConfigFromRequest(
        { authenticationMethod: 'api-key', staticApiKey: 'key123' },
        'host1',
      );

      expect(configApiKey.backend.authentication.authenticationMethod).toBe('api-key');
      expect(configApiKey.backend.authentication.staticApiKey).toBe('key123');

      const configKeycloak = buildAgentManagerCloudInitConfigFromRequest(
        {
          authenticationMethod: 'keycloak',
          keycloak: {
            serverUrl: 'https://kc',
            authServerUrl: 'https://kc/auth',
            realm: 'r',
            clientId: 'c',
            clientSecret: 's',
          },
        },
        'host1',
      );

      expect(configKeycloak.backend.authentication.authenticationMethod).toBe('keycloak');
      expect(configKeycloak.backend.authentication.keycloak?.realm).toBe('r');
    });

    it('does not include provisioning or disableSignup in config shape', () => {
      const config = buildAgentManagerCloudInitConfigFromRequest(
        { authenticationMethod: 'api-key', hetznerApiToken: 'ignored', disableSignup: true },
        'host1',
      );

      expect(config.backend).toBeDefined();
      expect((config.backend as Record<string, unknown>).provisioning).toBeUndefined();
      expect((config.backend.authentication as Record<string, unknown>).disableSignup).toBeUndefined();
    });

    it('generates random encryptionKey and jwtSecret', () => {
      const config1 = buildAgentManagerCloudInitConfigFromRequest({ authenticationMethod: 'api-key' }, 'host1');
      const config2 = buildAgentManagerCloudInitConfigFromRequest({ authenticationMethod: 'api-key' }, 'host2');

      expect(config1.backend.encryption.encryptionKey).toBeTruthy();
      expect(config1.backend.encryption.jwtSecret).toBeTruthy();
      expect(config1.backend.encryption.encryptionKey).not.toBe(config2.backend.encryption.encryptionKey);
      expect(config1.backend.encryption.jwtSecret).not.toBe(config2.backend.encryption.jwtSecret);
    });

    it('includes git config when request has git', () => {
      const config = buildAgentManagerCloudInitConfigFromRequest(
        {
          authenticationMethod: 'api-key',
          git: {
            repositoryUrl: 'https://github.com/org/repo.git',
            username: 'gituser',
            token: 'pat',
            commitAuthorName: 'Bot',
            commitAuthorEmail: 'bot@example.com',
          },
        },
        'host1',
      );

      expect(config.backend.git).toBeDefined();
      expect(config.backend.git?.repositoryUrl).toBe('https://github.com/org/repo.git');
      expect(config.backend.git?.username).toBe('gituser');
      expect(config.backend.git?.token).toBe('pat');
      expect(config.backend.git?.commitAuthorName).toBe('Bot');
      expect(config.backend.git?.commitAuthorEmail).toBe('bot@example.com');
      expect(config.backend.git?.setupMode).toBe('clone');
    });

    it('includes git setupMode empty when request specifies empty repository', () => {
      const config = buildAgentManagerCloudInitConfigFromRequest(
        {
          authenticationMethod: 'api-key',
          git: { setupMode: 'empty' },
        },
        'host1',
      );

      expect(config.backend.git?.setupMode).toBe('empty');
      expect(config.backend.git?.repositoryUrl).toBe('');
    });

    it('omits backend.git when request has no git', () => {
      const config = buildAgentManagerCloudInitConfigFromRequest({ authenticationMethod: 'api-key' }, 'host1');

      expect(config.backend.git).toBeUndefined();
    });

    it('includes cursorApiKey when request has cursorApiKey', () => {
      const config = buildAgentManagerCloudInitConfigFromRequest(
        { authenticationMethod: 'api-key', cursorApiKey: ' sk-secret-123 ' },
        'host1',
      );

      expect(config.backend.cursorApiKey).toBe('sk-secret-123');
    });

    it('omits backend.cursorApiKey when request has no or empty cursorApiKey', () => {
      const config1 = buildAgentManagerCloudInitConfigFromRequest({ authenticationMethod: 'api-key' }, 'host1');
      const config2 = buildAgentManagerCloudInitConfigFromRequest(
        { authenticationMethod: 'api-key', cursorApiKey: '   ' },
        'host1',
      );

      expect(config1.backend.cursorApiKey).toBeUndefined();
      expect(config2.backend.cursorApiKey).toBeUndefined();
    });

    it('sets ssh.publicKey from effectiveConfig.sshPublicKey when provided', () => {
      const config = buildAgentManagerCloudInitConfigFromRequest(
        { authenticationMethod: 'api-key', sshPublicKey: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ user@host' },
        'host1',
      );

      expect(config.ssh.publicKey).toBe('ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ user@host');
    });

    it('defaults ssh.publicKey to empty string when not provided', () => {
      const config = buildAgentManagerCloudInitConfigFromRequest({ authenticationMethod: 'api-key' }, 'host1');

      expect(config.ssh.publicKey).toBe('');
    });
  });

  describe('buildAgentManagerCloudInitUserData', () => {
    it('produces nginx config with api location and agent-manager', () => {
      const config: AgentManagerCloudInitConfig = {
        ssh: { publicKey: '' },
        host: { hostname: 'test', fqdn: 'test.spirde.com' },
        proxy: { httpPort: 80, httpsPort: 443, websocketPort: 8443 },
        backend: {
          host: '0.0.0.0',
          port: 3000,
          websocketPort: 8080,
          nodeEnv: 'production',
          database: {
            host: 'postgres',
            port: 5432,
            username: 'postgres',
            password: 'postgres',
            database: 'postgres',
          },
          authentication: { authenticationMethod: 'api-key', staticApiKey: 'key' },
          encryption: { encryptionKey: 'enc', jwtSecret: 'jwt' },
          smtp: { host: 'mailhog', port: 1025, user: '', password: '', from: 'noreply@localhost' },
          cors: { origin: 'https://test.spirde.com' },
        },
      };
      const b64 = buildAgentManagerCloudInitUserData(config);
      const script = Buffer.from(b64, 'base64').toString('utf-8');

      expect(script).toContain('location /');
      expect(script).toContain('agent-manager-api');
    });

    it('returns base64-encoded script containing agent-manager and docker compose', () => {
      const config: AgentManagerCloudInitConfig = {
        ssh: { publicKey: '' },
        host: { hostname: 'test', fqdn: 'test.spirde.com' },
        proxy: { httpPort: 80, httpsPort: 443, websocketPort: 8443 },
        backend: {
          host: '0.0.0.0',
          port: 3000,
          websocketPort: 8080,
          nodeEnv: 'production',
          database: {
            host: 'postgres',
            port: 5432,
            username: 'postgres',
            password: 'postgres',
            database: 'postgres',
          },
          authentication: { authenticationMethod: 'api-key', staticApiKey: 'key' },
          encryption: { encryptionKey: 'enc', jwtSecret: 'jwt' },
          smtp: { host: 'mailhog', port: 1025, user: '', password: '', from: 'noreply@localhost' },
          cors: { origin: 'https://test.spirde.com' },
        },
      };
      const b64 = buildAgentManagerCloudInitUserData(config);

      expect(Buffer.from(b64, 'base64').toString('utf-8')).toBeTruthy();
      const script = Buffer.from(b64, 'base64').toString('utf-8');

      expect(script).toContain('agent-manager');
      expect(script).toContain('docker compose up -d');
      expect(script).toContain('backend-agent-manager');
      expect(script).toContain('AUTHENTICATION_METHOD');
      expect(script).not.toContain('DISABLE_SIGNUP');
      expect(script).not.toContain('HETZNER_API_TOKEN');
      expect(script).toContain('JWT_SECRET: jwt');
    });

    it('configures certbot webroot, letsencrypt paths and renewal for fqdn', () => {
      const config: AgentManagerCloudInitConfig = {
        ssh: { publicKey: '' },
        host: { hostname: 'my-instance', fqdn: 'my-instance.example.com' },
        proxy: { httpPort: 80, httpsPort: 443, websocketPort: 8443 },
        backend: {
          host: '0.0.0.0',
          port: 3000,
          websocketPort: 8080,
          nodeEnv: 'production',
          authentication: { authenticationMethod: 'api-key' },
          encryption: { encryptionKey: 'k', jwtSecret: 's' },
          smtp: { host: 'm', port: 1025, user: '', password: '', from: 'n@l' },
          cors: { origin: '' },
        },
      };
      const b64 = buildAgentManagerCloudInitUserData(config);
      const script = Buffer.from(b64, 'base64').toString('utf-8');

      expect(script).toContain('certbot certonly --webroot');
      expect(script).toContain('/opt/certbot');
      expect(script).toContain('/.well-known/acme-challenge/');
      expect(script).toContain('/etc/letsencrypt/live/my-instance.example.com/fullchain.pem');
      expect(script).toContain('/etc/letsencrypt/live/my-instance.example.com/privkey.pem');
      expect(script).toContain("certbot renew -q --deploy-hook 'docker exec agent-manager-nginx nginx -s reload'");
      expect(script).toContain('subjectAltName=DNS:my-instance.example.com');
      expect(script).toContain('CN=my-instance.example.com');
    });

    it('includes GIT_* env vars in backend container when config.backend.git is set', () => {
      const config: AgentManagerCloudInitConfig = {
        ssh: { publicKey: '' },
        host: { hostname: 'test', fqdn: 'test.spirde.com' },
        proxy: { httpPort: 80, httpsPort: 443, websocketPort: 8443 },
        backend: {
          host: '0.0.0.0',
          port: 3000,
          websocketPort: 8080,
          nodeEnv: 'production',
          database: {
            host: 'postgres',
            port: 5432,
            username: 'postgres',
            password: 'postgres',
            database: 'postgres',
          },
          authentication: { authenticationMethod: 'api-key', staticApiKey: 'key' },
          encryption: { encryptionKey: 'enc', jwtSecret: 'jwt' },
          smtp: { host: 'mailhog', port: 1025, user: '', password: '', from: 'noreply@localhost' },
          cors: { origin: 'https://test.spirde.com' },
          git: {
            repositoryUrl: 'https://github.com/org/repo.git',
            username: 'gituser',
            token: 'secret',
            commitAuthorName: 'Agent',
            commitAuthorEmail: 'agent@example.com',
          },
        },
      };
      const b64 = buildAgentManagerCloudInitUserData(config);
      const script = Buffer.from(b64, 'base64').toString('utf-8');

      expect(script).toContain('GIT_REPOSITORY_URL: https://github.com/org/repo.git');
      expect(script).toContain('GIT_USERNAME: gituser');
      expect(script).toContain('GIT_TOKEN: secret');
      expect(script).toContain('GIT_COMMIT_AUTHOR_NAME: Agent');
      expect(script).toContain('GIT_COMMIT_AUTHOR_EMAIL: agent@example.com');
    });

    it('emits only GIT_REPOSITORY_SETUP_MODE when git setupMode is empty', () => {
      const config: AgentManagerCloudInitConfig = {
        ssh: { publicKey: '' },
        host: { hostname: 'test', fqdn: 'test.spirde.com' },
        proxy: { httpPort: 80, httpsPort: 443, websocketPort: 8443 },
        backend: {
          host: '0.0.0.0',
          port: 3000,
          websocketPort: 8080,
          nodeEnv: 'production',
          database: {
            host: 'postgres',
            port: 5432,
            username: 'postgres',
            password: 'postgres',
            database: 'postgres',
          },
          authentication: { authenticationMethod: 'api-key', staticApiKey: 'key' },
          encryption: { encryptionKey: 'enc', jwtSecret: 'jwt' },
          smtp: { host: 'mailhog', port: 1025, user: '', password: '', from: 'noreply@localhost' },
          cors: { origin: 'https://test.spirde.com' },
          git: { setupMode: 'empty' },
        },
      };
      const b64 = buildAgentManagerCloudInitUserData(config);
      const script = Buffer.from(b64, 'base64').toString('utf-8');

      expect(script).toContain('GIT_REPOSITORY_SETUP_MODE: empty');
      expect(script).not.toContain('GIT_REPOSITORY_URL');
      expect(script).not.toContain('GIT_USERNAME');
      expect(script).not.toContain('GIT_TOKEN');
    });

    it('omits GIT_* env vars when config.backend.git is absent', () => {
      const config: AgentManagerCloudInitConfig = {
        ssh: { publicKey: '' },
        host: { hostname: 'test', fqdn: 'test.spirde.com' },
        proxy: { httpPort: 80, httpsPort: 443, websocketPort: 8443 },
        backend: {
          host: '0.0.0.0',
          port: 3000,
          websocketPort: 8080,
          nodeEnv: 'production',
          database: {
            host: 'postgres',
            port: 5432,
            username: 'postgres',
            password: 'postgres',
            database: 'postgres',
          },
          authentication: { authenticationMethod: 'api-key', staticApiKey: 'key' },
          encryption: { encryptionKey: 'enc', jwtSecret: 'jwt' },
          smtp: { host: 'mailhog', port: 1025, user: '', password: '', from: 'noreply@localhost' },
          cors: { origin: 'https://test.spirde.com' },
        },
      };
      const b64 = buildAgentManagerCloudInitUserData(config);
      const script = Buffer.from(b64, 'base64').toString('utf-8');

      expect(script).not.toContain('GIT_REPOSITORY_URL');
      expect(script).not.toContain('GIT_USERNAME');
    });

    it('includes CURSOR_API_KEY in backend env when config.backend.cursorApiKey is set', () => {
      const config: AgentManagerCloudInitConfig = {
        ssh: { publicKey: '' },
        host: { hostname: 'test', fqdn: 'test.spirde.com' },
        proxy: { httpPort: 80, httpsPort: 443, websocketPort: 8443 },
        backend: {
          host: '0.0.0.0',
          port: 3000,
          websocketPort: 8080,
          nodeEnv: 'production',
          database: {
            host: 'postgres',
            port: 5432,
            username: 'postgres',
            password: 'postgres',
            database: 'postgres',
          },
          authentication: { authenticationMethod: 'api-key', staticApiKey: 'key' },
          encryption: { encryptionKey: 'enc', jwtSecret: 'jwt' },
          smtp: { host: 'mailhog', port: 1025, user: '', password: '', from: 'noreply@localhost' },
          cors: { origin: 'https://test.spirde.com' },
          cursorApiKey: 'sk-test-key',
        },
      };
      const b64 = buildAgentManagerCloudInitUserData(config);
      const script = Buffer.from(b64, 'base64').toString('utf-8');

      expect(script).toContain('CURSOR_API_KEY: sk-test-key');
    });

    it('omits CURSOR_API_KEY when config.backend.cursorApiKey is absent', () => {
      const config: AgentManagerCloudInitConfig = {
        ssh: { publicKey: '' },
        host: { hostname: 'test', fqdn: 'test.spirde.com' },
        proxy: { httpPort: 80, httpsPort: 443, websocketPort: 8443 },
        backend: {
          host: '0.0.0.0',
          port: 3000,
          websocketPort: 8080,
          nodeEnv: 'production',
          database: {
            host: 'postgres',
            port: 5432,
            username: 'postgres',
            password: 'postgres',
            database: 'postgres',
          },
          authentication: { authenticationMethod: 'api-key', staticApiKey: 'key' },
          encryption: { encryptionKey: 'enc', jwtSecret: 'jwt' },
          smtp: { host: 'mailhog', port: 1025, user: '', password: '', from: 'noreply@localhost' },
          cors: { origin: 'https://test.spirde.com' },
        },
      };
      const b64 = buildAgentManagerCloudInitUserData(config);
      const script = Buffer.from(b64, 'base64').toString('utf-8');

      expect(script).not.toContain('CURSOR_API_KEY');
    });

    it('includes ssh.publicKey in authorized_keys in the script when set', () => {
      const key = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ user@host';
      const config: AgentManagerCloudInitConfig = {
        ssh: { publicKey: key },
        host: { hostname: 'test', fqdn: 'test.spirde.com' },
        proxy: { httpPort: 80, httpsPort: 443, websocketPort: 8443 },
        backend: {
          host: '0.0.0.0',
          port: 3000,
          websocketPort: 8080,
          nodeEnv: 'production',
          database: {
            host: 'postgres',
            port: 5432,
            username: 'postgres',
            password: 'postgres',
            database: 'postgres',
          },
          authentication: { authenticationMethod: 'api-key', staticApiKey: 'key' },
          encryption: { encryptionKey: 'enc', jwtSecret: 'jwt' },
          smtp: { host: 'mailhog', port: 1025, user: '', password: '', from: 'noreply@localhost' },
          cors: { origin: 'https://test.spirde.com' },
        },
      };
      const b64 = buildAgentManagerCloudInitUserData(config);
      const script = Buffer.from(b64, 'base64').toString('utf-8');

      expect(script).toContain('/root/.ssh/authorized_keys');
      expect(script).toContain(key);
    });

    it('configures OpenSSH server with sshd_config and restarts service', () => {
      const config: AgentManagerCloudInitConfig = {
        ssh: { publicKey: '' },
        host: { hostname: 'test', fqdn: 'test.spirde.com' },
        proxy: { httpPort: 80, httpsPort: 443, websocketPort: 8443 },
        backend: {
          host: '0.0.0.0',
          port: 3000,
          websocketPort: 8080,
          nodeEnv: 'production',
          database: {
            host: 'postgres',
            port: 5432,
            username: 'postgres',
            password: 'postgres',
            database: 'postgres',
          },
          authentication: { authenticationMethod: 'api-key', staticApiKey: 'key' },
          encryption: { encryptionKey: 'enc', jwtSecret: 'jwt' },
          smtp: { host: 'mailhog', port: 1025, user: '', password: '', from: 'noreply@localhost' },
          cors: { origin: 'https://test.spirde.com' },
        },
      };
      const b64 = buildAgentManagerCloudInitUserData(config);
      const script = Buffer.from(b64, 'base64').toString('utf-8');

      expect(script).toContain('/etc/ssh/sshd_config');
      expect(script).toContain('PermitRootLogin yes');
      expect(script).toContain('PasswordAuthentication no');
      expect(script).toContain('Configuring SSH server');
      expect(script).toContain('service ssh restart');
    });
  });

  describe('buildAgentManagerUpdateCommand', () => {
    it('returns a command that logs to agent-manager-update.log and runs docker compose up -d --pull=always', () => {
      const cmd = buildAgentManagerUpdateCommand();

      expect(cmd).toContain('/var/log/agent-manager-update.log');
      expect(cmd).toContain('cd /opt/agent-manager');
      expect(cmd).toContain('docker compose up -d --pull=always');
      expect(cmd).toContain('ERROR: Update failed');
    });
  });
});
