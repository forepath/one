import { randomBytes } from 'crypto';

import { buildCertbotBootstrapScript } from '../../utils/cloud-init/certbot-bootstrap.script';
import { buildComposeBridgeNetwork, buildComposeNamedVolumes } from '../../utils/cloud-init/compose-service.utils';
import { formatEnvLines as formatEnv } from '../../utils/cloud-init/env.utils';
import { buildNginxComposeService } from '../../utils/cloud-init/nginx-compose.utils';
import {
  OPENSEARCH_COMPOSE_DEPENDS_ON,
  buildOpenSearchBackendEnvLines,
  buildOpenSearchComposeService,
  buildOpenSearchHostSysctlScript,
} from '../../utils/cloud-init/opensearch-compose.utils';
import {
  POSTGRES_COMPOSE_DEPENDS_ON,
  buildPostgresBackendEnvLines,
  buildPostgresComposeService,
} from '../../utils/cloud-init/postgres-compose.utils';
import {
  REDIS_COMPOSE_DEPENDS_ON,
  buildRedisBackendEnvLines,
  buildRedisComposeService,
} from '../../utils/cloud-init/redis-compose.utils';

export const DECABILL_BILLING_STACK_DIR = '/opt/decabill-billing';

export interface DecabillBillingCloudInitConfig {
  ssh: {
    publicKey: string;
  };
  host: {
    hostname: string;
    /** Fully qualified domain name for SSL and CORS */
    fqdn: string;
  };
  proxy: {
    httpPort: number;
    httpsPort: number;
    websocketPort: number;
  };
  frontend: {
    host: string;
    port: number;
    nodeEnv: string;
    defaultLocale: string;
    cspEnforce?: string;
  };
  backend: {
    host: string;
    port: number;
    websocketPort: number;
    websocketNamespace: string;
    nodeEnv: string;
    defaultLocale: string;
    provisioning?: {
      hetznerApiToken?: string;
      digitaloceanApiToken?: string;
    };
    database?: {
      host: string;
      port: number;
      username: string;
      password: string;
      database: string;
    };
    authentication: {
      authenticationMethod: string;
      staticApiKey?: string;
      keycloak?: {
        serverUrl: string;
        authServerUrl: string;
        realm: string;
        clientId: string;
        clientSecret: string;
      };
      disableSignup: boolean;
      disableForceLogin2fa?: boolean;
    };
    encryption: {
      jwtSecret: string;
      encryptionKey: string;
    };
    smtp: {
      host: string;
      port: number;
      user: string;
      password: string;
      from: string;
    };
    cors: {
      origin: string;
    };
    rateLimit: {
      enabled: boolean;
      ttl: number;
      limit: number;
    };
    billingFrontendUrl: string;
  };
}

/**
 * Builds Decabill billing stack cloud-init config from plan defaults + requestedConfig.
 * Generates random encryptionKey and jwtSecret.
 */
export function buildDecabillBillingCloudInitConfigFromRequest(
  effectiveConfig: Record<string, unknown>,
  hostname: string,
  baseDomain = 'spirde.com',
): DecabillBillingCloudInitConfig {
  const encryptionKey = randomBytes(32).toString('base64');
  const jwtSecret = randomBytes(32).toString('hex');
  const databasePassword = randomBytes(24).toString('base64url');
  const fqdn = `${hostname}.${baseDomain}`;
  const smtp = effectiveConfig.smtp as Record<string, unknown> | undefined;
  const keycloak = effectiveConfig.keycloak as Record<string, unknown> | undefined;
  const billingFrontendUrl = `https://${fqdn}`;

  return {
    ssh: {
      publicKey: (effectiveConfig.sshPublicKey as string) ?? '',
    },
    host: { hostname, fqdn },
    proxy: {
      httpPort: 80,
      httpsPort: 443,
      websocketPort: 8443,
    },
    frontend: {
      host: '0.0.0.0',
      port: 4500,
      nodeEnv: 'production',
      defaultLocale: 'en',
    },
    backend: {
      host: '0.0.0.0',
      port: 3200,
      websocketPort: 8082,
      websocketNamespace: 'billing',
      nodeEnv: 'production',
      defaultLocale: 'en',
      database: {
        host: 'postgres',
        port: 5432,
        username: 'postgres',
        password: databasePassword,
        database: 'postgres',
      },
      authentication: {
        authenticationMethod: (effectiveConfig.authenticationMethod as string) ?? 'users',
        disableSignup: (effectiveConfig.disableSignup as boolean) ?? false,
        disableForceLogin2fa: (effectiveConfig.disableForceLogin2fa as boolean) ?? false,
        staticApiKey: (effectiveConfig.staticApiKey as string) ?? '',
        ...(keycloak && {
          keycloak: {
            serverUrl: (keycloak.serverUrl as string) ?? '',
            authServerUrl: (keycloak.authServerUrl as string) ?? '',
            realm: (keycloak.realm as string) ?? '',
            clientId: (keycloak.clientId as string) ?? '',
            clientSecret: (keycloak.clientSecret as string) ?? '',
          },
        }),
      },
      encryption: { encryptionKey, jwtSecret },
      smtp: {
        host: (smtp?.host as string) ?? 'mailhog',
        port: (smtp?.port as number) ?? 1025,
        user: (smtp?.user as string) ?? '',
        password: (smtp?.password as string) ?? '',
        from: (smtp?.from as string) ?? 'noreply@localhost',
      },
      cors: { origin: billingFrontendUrl },
      rateLimit: { enabled: true, ttl: 60, limit: 100 },
      provisioning: {
        hetznerApiToken: (effectiveConfig.hetznerApiToken as string) ?? '',
        digitaloceanApiToken: (effectiveConfig.digitaloceanApiToken as string) ?? '',
      },
      billingFrontendUrl,
    },
  };
}

export function buildDecabillBillingCloudInitUserData(config: DecabillBillingCloudInitConfig): string {
  const heredocMarker = `DECABILL_${randomBytes(16).toString('hex')}`;
  const backendEnvBaseLines = [
    `HOST: ${config.backend?.host ?? '0.0.0.0'}`,
    `PORT: ${config.backend?.port ?? '3200'}`,
    `WEBSOCKET_PORT: ${config.backend?.websocketPort ?? '8082'}`,
    `WEBSOCKET_NAMESPACE: ${config.backend?.websocketNamespace ?? 'billing'}`,
    `NODE_ENV: ${config.backend?.nodeEnv ?? 'production'}`,
    ...buildPostgresBackendEnvLines(config.backend?.database),
    ...buildRedisBackendEnvLines('decabill-billing'),
    ...buildOpenSearchBackendEnvLines('decabill'),
    `QUEUE_WORKER_CONCURRENCY: 5`,
    `QUEUE_BULL_BOARD_ENABLED: false`,
    `QUEUE_BULL_BOARD_PATH: /admin/queues`,
    `QUEUE_BULL_BOARD_USERNAME: admin`,
    `QUEUE_BULL_BOARD_PASSWORD: `,
    `AUTHENTICATION_METHOD: ${config.backend?.authentication?.authenticationMethod ?? 'api-key'}`,
    `STATIC_API_KEY: ${config.backend?.authentication?.staticApiKey ?? ''}`,
    `KEYCLOAK_SERVER_URL: ${config.backend?.authentication?.keycloak?.serverUrl ?? ''}`,
    `KEYCLOAK_AUTH_SERVER_URL: ${config.backend?.authentication?.keycloak?.authServerUrl ?? ''}`,
    `KEYCLOAK_REALM: ${config.backend?.authentication?.keycloak?.realm ?? ''}`,
    `KEYCLOAK_CLIENT_ID: ${config.backend?.authentication?.keycloak?.clientId ?? ''}`,
    `KEYCLOAK_CLIENT_SECRET: ${config.backend?.authentication?.keycloak?.clientSecret ?? ''}`,
    `HETZNER_API_TOKEN: ${config.backend?.provisioning?.hetznerApiToken ?? ''}`,
    `DIGITALOCEAN_API_TOKEN: ${config.backend?.provisioning?.digitaloceanApiToken ?? ''}`,
    `DISABLE_SIGNUP: ${config.backend?.authentication?.disableSignup ?? 'false'}`,
    `DISABLE_FORCE_LOGIN_2FA: ${config.backend?.authentication?.disableForceLogin2fa ?? 'false'}`,
    `ENCRYPTION_KEY: ${config.backend?.encryption?.encryptionKey ?? ''}`,
    `JWT_SECRET: ${config.backend?.encryption?.jwtSecret ?? ''}`,
    `SMTP_HOST: ${config.backend?.smtp?.host ?? 'mailhog'}`,
    `SMTP_PORT: ${config.backend?.smtp?.port ?? '1025'}`,
    `SMTP_USER: ${config.backend?.smtp?.user ?? ''}`,
    `SMTP_PASSWORD: ${config.backend?.smtp?.password ?? ''}`,
    `EMAIL_FROM: ${config.backend?.smtp?.from ?? 'noreply@localhost'}`,
    `CORS_ORIGIN: ${config.backend?.cors?.origin ?? ''}`,
    `RATE_LIMIT_ENABLED: ${config.backend?.rateLimit?.enabled ?? 'true'}`,
    `RATE_LIMIT_TTL: ${config.backend?.rateLimit?.ttl ?? '60'}`,
    `RATE_LIMIT_LIMIT: ${config.backend?.rateLimit?.limit ?? '100'}`,
    `BILLING_FRONTEND_URL: ${config.backend?.billingFrontendUrl ?? ''}`,
    `BILLING_ISSUER_COUNTRY: DE`,
    `BILLING_TAX_RATE_STANDARD: 19`,
    `BILLING_TAX_RATE_REDUCED: 7`,
    `FILE_STORAGE_PROVIDER: local`,
    `FILE_STORAGE_ROOT: /data`,
    `FILE_STORAGE_LEGACY_MIGRATION_ENABLED: true`,
    `BILLING_DATEV_EXPORT_ENABLED: false`,
    `TENANTS_ALLOW_DEFAULT: true`,
    `DNS_BASE_DOMAIN: ${config.host?.fqdn?.split('.').slice(1).join('.') || 'spirde.com'}`,
  ];
  const backendApiEnv = formatEnv([...backendEnvBaseLines, `QUEUE_ROLE: api`]);
  const backendWorkerEnv = formatEnv([...backendEnvBaseLines, `QUEUE_ROLE: worker`]);
  const backendSchedulerEnv = formatEnv([...backendEnvBaseLines, `QUEUE_ROLE: scheduler`]);
  const frontendEnv = formatEnv([
    `HOST: ${config.frontend?.host ?? '0.0.0.0'}`,
    `PORT: ${config.frontend?.port ?? '4500'}`,
    `NODE_ENV: ${config.frontend?.nodeEnv ?? 'production'}`,
    `DEFAULT_LOCALE: ${config.frontend?.defaultLocale ?? 'en'}`,
    `CONFIG_ALLOWED_HOSTS: ${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'}`,
    `CSP_ENFORCE: ${config.frontend?.cspEnforce ?? 'true'}`,
  ]);
  const authMethod = config.backend?.authentication?.authenticationMethod ?? 'users';
  const frontendConfig = {
    production: true,
    controller: {
      restApiUrl: '',
      websocketUrl: 'not_applicable',
    },
    billing: {
      restApiUrl: `https://${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'}:${config.proxy?.httpsPort ?? '443'}/api`,
      frontendUrl: `https://${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'}`,
      websocketUrl: `https://${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'}:${config.proxy?.httpsPort ?? '443'}/${config.backend?.websocketNamespace ?? 'billing'}`,
      tenantId: 'default',
    },
    authentication: {
      type: authMethod === 'api-key' ? 'api-key' : authMethod === 'keycloak' ? 'keycloak' : 'users',
      disableSignup: config.backend?.authentication?.disableSignup ?? false,
    },
    cookieConsent: {
      domain: `.${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'}`,
      privacyPolicyUrl: 'https://decabill.com/legal/privacy',
      termsUrl: 'https://decabill.com/legal/terms',
    },
  };
  const dockerCompose = `services:
${buildPostgresComposeService({
  containerName: 'decabill-billing-postgres',
  network: 'decabill-billing-network',
  username: config.backend?.database?.username ?? 'postgres',
  password: config.backend?.database?.password ?? 'postgres',
  database: config.backend?.database?.database ?? 'postgres',
})}

${buildRedisComposeService({
  containerName: 'decabill-billing-redis',
  network: 'decabill-billing-network',
})}

${buildOpenSearchComposeService({
  containerName: 'decabill-billing-opensearch',
  network: 'decabill-billing-network',
})}

  backend-billing-manager:
    image: ghcr.io/forepath/decabill-billing-api:latest
    pull_policy: always
    container_name: decabill-billing-api
    environment:
${backendApiEnv}
    volumes:
      - billing_file_data:/data
    ports:
      - '${config.backend?.port ?? '3200'}:${config.backend?.port ?? '3200'}'
      - '${config.backend?.websocketPort ?? '8082'}:${config.backend?.websocketPort ?? '8082'}'
    depends_on:
${POSTGRES_COMPOSE_DEPENDS_ON}
${REDIS_COMPOSE_DEPENDS_ON}
${OPENSEARCH_COMPOSE_DEPENDS_ON}
    networks:
      - decabill-billing-network
    restart: unless-stopped

  backend-billing-manager-worker:
    image: ghcr.io/forepath/decabill-billing-api:latest
    pull_policy: always
    container_name: decabill-billing-worker
    environment:
${backendWorkerEnv}
    volumes:
      - billing_file_data:/data
    depends_on:
${POSTGRES_COMPOSE_DEPENDS_ON}
${REDIS_COMPOSE_DEPENDS_ON}
${OPENSEARCH_COMPOSE_DEPENDS_ON}
    networks:
      - decabill-billing-network
    restart: unless-stopped

  backend-billing-manager-scheduler:
    image: ghcr.io/forepath/decabill-billing-api:latest
    pull_policy: always
    container_name: decabill-billing-scheduler
    environment:
${backendSchedulerEnv}
    volumes:
      - billing_file_data:/data
    depends_on:
${POSTGRES_COMPOSE_DEPENDS_ON}
${REDIS_COMPOSE_DEPENDS_ON}
${OPENSEARCH_COMPOSE_DEPENDS_ON}
    networks:
      - decabill-billing-network
    restart: unless-stopped

  frontend-billing-console-server:
    image: ghcr.io/forepath/decabill-billing-console-server:latest
    pull_policy: always
    container_name: decabill-billing-console-server
    command: ['/bin/sh', '-c', 'CONFIG=https://${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'}:${config.proxy?.httpsPort ?? '443'}/config.json node server.cjs']
    environment:
${frontendEnv}
    ports:
      - '${config.frontend?.port ?? '4500'}:${config.frontend?.port ?? '4500'}'
    networks:
      - decabill-billing-network
    restart: unless-stopped

${buildNginxComposeService({
  containerName: 'decabill-billing-nginx',
  network: 'decabill-billing-network',
  stackDir: DECABILL_BILLING_STACK_DIR,
  httpPort: config.proxy?.httpPort ?? 80,
  httpsPort: config.proxy?.httpsPort ?? 443,
  websocketPort: config.proxy?.websocketPort ?? 8443,
  dependsOn: ['frontend-billing-console-server', 'backend-billing-manager'],
})}

${buildComposeNamedVolumes(['postgres_data', 'redis_data', 'opensearch_data', 'billing_file_data'])}

${buildComposeBridgeNetwork('decabill-billing-network')}
`;
  const nginxBootstrapConfig = `
server {
    listen ${config.proxy?.httpPort ?? '80'};
    server_name ${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'};

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen ${config.proxy?.httpsPort ?? '443'} ssl http2;
    server_name ${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'};

    ssl_certificate /etc/nginx/ssl/bootstrap.crt;
    ssl_certificate_key /etc/nginx/ssl/bootstrap.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://decabill-billing-console-server:${config.frontend?.port ?? '4500'};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://decabill-billing-api:${config.backend?.port ?? '3200'};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /${config.backend?.websocketNamespace ?? 'billing'} {
        proxy_pass http://decabill-billing-api:${config.backend?.websocketPort ?? '8082'};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /socket.io/ {
        proxy_pass http://decabill-billing-api:${config.backend?.websocketPort ?? '8082'};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /config.json {
        return 200 '${JSON.stringify(frontendConfig || {})}';
    }
}
`;
  const nginxLetsEncryptConfig = `
server {
    listen ${config.proxy?.httpPort ?? '80'};
    server_name ${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'};

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen ${config.proxy?.httpsPort ?? '443'} ssl http2;
    server_name ${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'};

    ssl_certificate /etc/letsencrypt/live/${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://decabill-billing-console-server:${config.frontend?.port ?? '4500'};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://decabill-billing-api:${config.backend?.port ?? '3200'};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /${config.backend?.websocketNamespace ?? 'billing'} {
        proxy_pass http://decabill-billing-api:${config.backend?.websocketPort ?? '8082'};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /socket.io/ {
        proxy_pass http://decabill-billing-api:${config.backend?.websocketPort ?? '8082'};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /config.json {
        return 200 '${JSON.stringify(frontendConfig || {})}';
    }
}
`;
  const sshConfig = `
Include /etc/ssh/sshd_config.d/*.conf
PermitRootLogin yes
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM yes
X11Forwarding yes
PrintMotd no
AcceptEnv LANG LC_*
Subsystem       sftp    /usr/lib/openssh/sftp-server
`;
  const script = `#!/bin/bash
set -euo pipefail

# Cloud-init user-data script for decabill-billing provisioning

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a /var/log/decabill-billing-provisioning.log
}

log "Starting server provisioning script (cloud-init user-data)"

log "Verifying network connectivity..."
for i in {1..10}; do
    if ping -c 1 -W 2 8.8.8.8 > /dev/null 2>&1; then
        log "Network is ready"
        break
    fi
    if [ $i -eq 10 ]; then
        log "WARNING: Network connectivity check failed, continuing anyway"
    fi
    sleep 1
done

export DEBIAN_FRONTEND=noninteractive
log "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

log "Installing openssh server..."
apt-get install -y openssh-server ssh

log "Adding SSH public key..."
mkdir -p /root/.ssh
echo "${config.ssh?.publicKey ?? ''}" > /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

log "Configuring SSH server..."
cat > /etc/ssh/sshd_config <<'EOF'
${sshConfig}
EOF
service ssh restart

log "Setting SSH password permanently..."
chage -d 1 -m 0 -M 99999 -I -1 -E -1 root

log "Installing prerequisites for Docker installation..."
apt-get update -qq
apt-get install -y ca-certificates curl

log "Installing Docker using convenience script..."
curl -fsSL https://get.docker.com -o get-docker.sh
sh ./get-docker.sh
rm -f get-docker.sh

log "Starting Docker service..."
systemctl enable docker
systemctl start docker

log "Waiting for Docker to be ready..."
for i in {1..30}; do
    if docker info > /dev/null 2>&1; then
        log "Docker is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        log "ERROR: Docker failed to start after 30 attempts"
        exit 1
    fi
    sleep 2
done

if ! docker info > /dev/null 2>&1; then
    log "ERROR: Docker is not working properly"
    exit 1
fi

log "Creating decabill-billing directory..."
mkdir -p ${DECABILL_BILLING_STACK_DIR}

log "Creating nginx sites-enabled directory..."
mkdir -p ${DECABILL_BILLING_STACK_DIR}/sites-enabled

log "Creating nginx configuration file..."
cat > ${DECABILL_BILLING_STACK_DIR}/sites-enabled/default.conf <<'${heredocMarker}'
${nginxBootstrapConfig}
${heredocMarker}

log "Creating nginx ssl directory..."
mkdir -p ${DECABILL_BILLING_STACK_DIR}/ssl

log "Generating bootstrap SSL certificate..."
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \\
    -keyout ${DECABILL_BILLING_STACK_DIR}/ssl/bootstrap.key \\
    -out ${DECABILL_BILLING_STACK_DIR}/ssl/bootstrap.crt \\
    -subj "/C=DE/ST=Nordrhein-Westfalen/L=Herford/O=Decabill/CN=${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'}" \\
    -addext "subjectAltName=DNS:${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'}" 2>/dev/null || {
    log "WARNING: Failed to generate bootstrap SSL certificate, nginx may not start properly"
}

chmod 600 ${DECABILL_BILLING_STACK_DIR}/ssl/bootstrap.key
chmod 644 ${DECABILL_BILLING_STACK_DIR}/ssl/bootstrap.crt

${buildOpenSearchHostSysctlScript()}
log "Creating docker-compose.yaml file..."
cat > ${DECABILL_BILLING_STACK_DIR}/docker-compose.yaml <<'${heredocMarker}'
${dockerCompose}
${heredocMarker}

log "Starting decabill-billing containers..."
cd ${DECABILL_BILLING_STACK_DIR}
docker compose up -d || {
    log "ERROR: Failed to start decabill-billing containers"
    docker compose logs || true
    exit 1
}

${buildCertbotBootstrapScript({
  stackName: 'decabill-billing',
  stackDir: DECABILL_BILLING_STACK_DIR,
  nginxContainerName: 'decabill-billing-nginx',
  fqdn: config.host?.fqdn ?? config.host?.hostname ?? 'localhost',
  letsEncryptEmail: process.env.LETS_ENCRYPT_EMAIL,
  letsEncryptNginxConfig: nginxLetsEncryptConfig,
})}

log "decabill-billing provisioning completed successfully at $(date)"
`;

  return Buffer.from(script).toString('base64');
}

const DECABILL_BILLING_UPDATE_LOG = '/var/log/decabill-billing-update.log';

/**
 * Builds the shell command to pull latest Decabill billing images on a provisioned host.
 */
export function buildDecabillBillingUpdateCommand(): string {
  return `log() { echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a ${DECABILL_BILLING_UPDATE_LOG}; }; log "Starting update"; cd ${DECABILL_BILLING_STACK_DIR} && docker compose up -d --pull=always 2>&1 | tee -a ${DECABILL_BILLING_UPDATE_LOG} || { log "ERROR: Update failed"; exit 1; }; log "Update completed"`;
}
