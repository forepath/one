import { randomBytes } from 'crypto';

import { parseAllowedHosts } from '@forepath/shared/shared/util-network-address';

import { buildCertbotBootstrapScript } from './certbot-bootstrap.script';
import { formatEnvLines as formatEnv, quoteYamlScalar } from './env.utils';

export interface AgentControllerCloudInitConfig {
  ssh: {
    publicKey: string;
  };
  host: {
    hostname: string;
    /** Fully qualified domain name (e.g. awesome-armadillo-abc12.spirde.com) for SSL and CORS */
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
    /**
     * Client workspace (agent-manager) URL SSRF / TLS policy for the backend API.
     * Billing-provisioned stacks default to strict TLS, HTTPS-only outbound, DNS validation on,
     * and **`CLIENT_ENDPOINT_ALLOWED_HOSTS=*`** so tenants may use arbitrary agent-manager hostnames.
     * Optional **`clientEndpointAllowedHosts`** / **`security.clientEndpointAllowedHosts`** merge the instance FQDN
     * with listed hosts (or `*` only) for stricter allowlists.
     */
    clientEndpoint?: {
      allowedHosts?: string;
      allowInsecureHttp?: boolean;
      tlsRejectUnauthorized?: boolean;
    };
  };
}

/**
 * Client-endpoint hostname allowlist for billing-provisioned agent-controller:
 * default `*`; when **`requestedConfig`** lists explicit hosts, merge instance FQDN first (deduped).
 * Literal `*` in the explicit list yields allow-all.
 */
export function buildMergedClientEndpointAllowedHosts(provisionedFqdn: string, explicitRaw?: string): string {
  const fq = provisionedFqdn.trim().toLowerCase();

  if (!explicitRaw?.trim()) {
    return '*';
  }

  const parsed = parseAllowedHosts(explicitRaw);

  if (parsed.includes('*')) {
    return '*';
  }

  const ordered = [fq, ...parsed.filter((h) => h !== fq)];
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const h of ordered) {
    if (!seen.has(h)) {
      seen.add(h);
      unique.push(h);
    }
  }

  return unique.join(',');
}

function resolveClientEndpointProvisioningOptions(
  effectiveConfig: Record<string, unknown>,
  provisionedFqdn: string,
): {
  allowedHosts: string;
  allowInsecureHttp: boolean;
  tlsRejectUnauthorized: boolean;
} {
  const sec = effectiveConfig.security as Record<string, unknown> | undefined;
  const fromSec =
    typeof sec?.clientEndpointAllowedHosts === 'string' ? (sec.clientEndpointAllowedHosts as string).trim() : '';
  const fromTop =
    typeof effectiveConfig.clientEndpointAllowedHosts === 'string'
      ? (effectiveConfig.clientEndpointAllowedHosts as string).trim()
      : '';
  const explicitRaw = fromSec !== '' ? fromSec : fromTop !== '' ? fromTop : undefined;
  const allowedHosts = buildMergedClientEndpointAllowedHosts(provisionedFqdn, explicitRaw);

  return {
    allowedHosts,
    allowInsecureHttp: Boolean(sec?.clientEndpointAllowInsecureHttp),
    tlsRejectUnauthorized: sec?.clientEndpointTlsRejectUnauthorized !== false,
  };
}

/**
 * Builds a full CloudInitConfig from effectiveConfig (plan defaults + requestedConfig) and hostname.
 * Generates random encryptionKey and jwtSecret. SMTP and auth options come from effectiveConfig with defaults.
 * @param baseDomain - Base domain for FQDN (e.g. spirde.com). Defaults to spirde.com.
 */
export function buildAgentControllerCloudInitConfigFromRequest(
  effectiveConfig: Record<string, unknown>,
  hostname: string,
  baseDomain = 'spirde.com',
): AgentControllerCloudInitConfig {
  const encryptionKey = randomBytes(32).toString('base64');
  const jwtSecret = randomBytes(32).toString('hex');
  const fqdn = `${hostname}.${baseDomain}`;
  const smtp = effectiveConfig.smtp as Record<string, unknown> | undefined;
  const keycloak = effectiveConfig.keycloak as Record<string, unknown> | undefined;

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
      port: 4200,
      nodeEnv: 'production',
      defaultLocale: 'en',
    },
    backend: {
      host: '0.0.0.0',
      port: 3100,
      websocketPort: 8081,
      websocketNamespace: 'websocket',
      nodeEnv: 'production',
      defaultLocale: 'en',
      database: {
        host: 'postgres',
        port: 5432,
        username: 'postgres',
        password: 'postgres',
        database: 'postgres',
      },
      authentication: {
        authenticationMethod: (effectiveConfig.authenticationMethod as string) ?? 'users',
        disableSignup: (effectiveConfig.disableSignup as boolean) ?? false,
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
      cors: { origin: `https://${fqdn}` },
      rateLimit: { enabled: false, ttl: 60, limit: 100 },
      provisioning: {
        hetznerApiToken: (effectiveConfig.hetznerApiToken as string) ?? '',
        digitaloceanApiToken: (effectiveConfig.digitaloceanApiToken as string) ?? '',
      },
      clientEndpoint: resolveClientEndpointProvisioningOptions(effectiveConfig, fqdn),
    },
  };
}

export function buildAgentControllerCloudInitUserData(config: AgentControllerCloudInitConfig): string {
  const backendEnvBaseLines = [
    // Backend web server configuration
    `HOST: ${config.backend?.host ?? '0.0.0.0'}`,
    `PORT: ${config.backend?.port ?? '3100'}`,
    `WEBSOCKET_PORT: ${config.backend?.websocketPort ?? '8081'}`,
    `WEBSOCKET_NAMESPACE: ${config.backend?.websocketNamespace ?? 'websocket'}`,
    `NODE_ENV: ${config.backend?.nodeEnv ?? 'production'}`,
    // Database configuration
    `DB_HOST: ${config.backend?.database?.host ?? 'postgres'}`,
    `DB_PORT: ${config.backend?.database?.port ?? '5432'}`,
    `DB_USERNAME: ${config.backend?.database?.username ?? 'postgres'}`,
    `DB_PASSWORD: ${config.backend?.database?.password ?? 'postgres'}`,
    `DB_DATABASE: ${config.backend?.database?.database ?? 'postgres'}`,
    // Redis / BullMQ configuration
    `REDIS_HOST: redis`,
    `REDIS_PORT: 6379`,
    `REDIS_PASSWORD: `,
    `REDIS_DB: 0`,
    `REDIS_KEY_PREFIX: agenstra-controller`,
    `QUEUE_WORKER_CONCURRENCY: 5`,
    // Coordinator / worker scheduler intervals (shared across api, worker, scheduler)
    `FILTER_RULES_SYNC_INTERVAL_MS: 30000`,
    `FILTER_RULES_SYNC_BATCH_SIZE: 10`,
    `CONTEXT_IMPORT_SCHEDULER_INTERVAL_MS: 120000`,
    `CONTEXT_IMPORT_SCHEDULER_CONFIG_BATCH: 3`,
    `CONTEXT_IMPORT_ITEM_BUDGET: 25`,
    `KNOWLEDGE_EMBEDDINGS_REINDEX_INTERVAL_MS: 3600000`,
    `AUTONOMOUS_TICKET_SCHEDULER_INTERVAL_MS: 60000`,
    `AUTONOMOUS_TICKET_SCHEDULER_BATCH_SIZE: 5`,
    // Bull Board (disabled by default for provisioned stacks; set to true + credentials if needed)
    `QUEUE_BULL_BOARD_ENABLED: false`,
    `QUEUE_BULL_BOARD_PATH: /admin/queues`,
    `QUEUE_BULL_BOARD_USERNAME: admin`,
    `QUEUE_BULL_BOARD_PASSWORD: `,
    // Authentication method configuration
    `AUTHENTICATION_METHOD: ${config.backend?.authentication?.authenticationMethod ?? 'api-key'}`,
    `STATIC_API_KEY: ${config.backend?.authentication?.staticApiKey ?? ''}`,
    `KEYCLOAK_SERVER_URL: ${config.backend?.authentication?.keycloak?.serverUrl ?? ''}`,
    `KEYCLOAK_AUTH_SERVER_URL: ${config.backend?.authentication?.keycloak?.authServerUrl ?? ''}`,
    `KEYCLOAK_REALM: ${config.backend?.authentication?.keycloak?.realm ?? ''}`,
    `KEYCLOAK_CLIENT_ID: ${config.backend?.authentication?.keycloak?.clientId ?? ''}`,
    `KEYCLOAK_CLIENT_SECRET: ${config.backend?.authentication?.keycloak?.clientSecret ?? ''}`,
    // Environment variables for the provisioning providers
    `HETZNER_API_TOKEN: ${config.backend?.provisioning?.hetznerApiToken ?? ''}`,
    `DIGITALOCEAN_API_TOKEN: ${config.backend?.provisioning?.digitaloceanApiToken ?? ''}`,
    // Environment variables for disabling signup
    `DISABLE_SIGNUP: ${config.backend?.authentication?.disableSignup ?? 'false'}`,
    // Environment variables for encryption
    `ENCRYPTION_KEY: ${config.backend?.encryption?.encryptionKey ?? ''}`,
    // Environment variables for users authentication (when AUTHENTICATION_METHOD=users)
    `JWT_SECRET: ${config.backend?.encryption?.jwtSecret ?? ''}`,
    // SMTP / MailHog configuration (for email confirmation and password reset)
    `SMTP_HOST: ${config.backend?.smtp?.host ?? 'mailhog'}`,
    `SMTP_PORT: ${config.backend?.smtp?.port ?? '1025'}`,
    `SMTP_USER: ${config.backend?.smtp?.user ?? ''}`,
    `SMTP_PASSWORD: ${config.backend?.smtp?.password ?? ''}`,
    `EMAIL_FROM: ${config.backend?.smtp?.from ?? 'noreply@localhost'}`,
    // CORS configuration (comma-separated list of allowed origins)
    `CORS_ORIGIN: ${config.backend?.cors?.origin ?? ''}`,
    // Rate limiting configuration
    `RATE_LIMIT_ENABLED: ${config.backend?.rateLimit?.enabled ?? 'false'}`,
    `RATE_LIMIT_TTL: ${config.backend?.rateLimit?.ttl ?? '60'}`,
    `RATE_LIMIT_LIMIT: ${config.backend?.rateLimit?.limit ?? '100'}`,
    // Client workspace (agent-manager) URL SSRF + TLS (mirrors chore/security_improvements provisioning)
    `CLIENT_ENDPOINT_TLS_REJECT_UNAUTHORIZED: ${config.backend?.clientEndpoint?.tlsRejectUnauthorized !== false}`,
    `CLIENT_ENDPOINT_ALLOW_INSECURE_HTTP: ${config.backend?.clientEndpoint?.allowInsecureHttp === true}`,
    `CLIENT_ENDPOINT_ALLOWED_HOSTS: ${
      config.backend?.clientEndpoint?.allowedHosts?.trim() ? config.backend.clientEndpoint.allowedHosts : '*'
    }`,
  ];
  const backendApiEnv = formatEnv([...backendEnvBaseLines, `QUEUE_ROLE: api`]);
  const backendWorkerEnv = formatEnv([...backendEnvBaseLines, `QUEUE_ROLE: worker`]);
  const backendSchedulerEnv = formatEnv([...backendEnvBaseLines, `QUEUE_ROLE: scheduler`]);
  const frontendEnv = formatEnv([
    // Frontend web server configuration
    `HOST: ${config.frontend?.host ?? '0.0.0.0'}`,
    `PORT: ${config.frontend?.port ?? '4200'}`,
    `NODE_ENV: ${config.frontend?.nodeEnv ?? 'production'}`,
    `DEFAULT_LOCALE: ${config.frontend?.defaultLocale ?? 'en'}`,
    // Runtime config proxy hardening: CONFIG_ALLOWED_HOSTS is required in production when CONFIG is set.
    `CONFIG_ALLOWED_HOSTS: ${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'}`,
    // Frontend security headers: enforce CSP by default for provisioned instances.
    `CSP_ENFORCE: ${config.frontend?.cspEnforce ?? 'true'}`,
  ]);
  const frontendConfig: any = {
    production: true,
    controller: {
      restApiUrl: `https://${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'}:${config.proxy?.httpsPort ?? '443'}/api`,
      websocketUrl: `https://${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'}:${config.proxy?.httpsPort ?? '443'}/${config.backend?.websocketNamespace ?? 'websocket'}`,
    },
    billing: {
      restApiUrl: '',
    },
    authentication: {
      type: 'users',
      disableSignup: false,
    },
    chatModelOptions: {
      cursor: {},
      opencode: {},
    },
    editor: {
      openInNewWindow: true,
    },
    deployment: {
      openInNewWindow: true,
    },
    cookieConsent: {
      domain: `.${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'}`,
      privacyPolicyUrl: 'https://agenstra.com/legal/privacy',
      termsUrl: 'https://agenstra.com/legal/terms',
    },
  };
  const dockerCompose = `services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: agent-controller-postgres
    environment:
      POSTGRES_USER: ${quoteYamlScalar(config.backend?.database?.username ?? 'postgres')}
      POSTGRES_PASSWORD: ${quoteYamlScalar(config.backend?.database?.password ?? 'postgres')}
      POSTGRES_DB: ${quoteYamlScalar(config.backend?.database?.database ?? 'postgres')}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${config.backend?.database?.username ?? 'postgres'}']
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - agent-controller-network
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: agent-controller-redis
    command: ['redis-server', '--appendonly', 'yes']
    volumes:
      - redis_data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - agent-controller-network
    restart: unless-stopped

  backend-agent-controller:
    image: ghcr.io/forepath/agenstra-controller-api:latest
    pull_policy: always
    container_name: agent-controller-api
    environment:
${backendApiEnv}
    ports:
      - '${config.backend?.port ?? '3100'}:${config.backend?.port ?? '3100'}'
      - '${config.backend?.websocketPort ?? '8081'}:${config.backend?.websocketPort ?? '8081'}'
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - agent-controller-network
    restart: unless-stopped

  backend-agent-controller-worker:
    image: ghcr.io/forepath/agenstra-controller-api:latest
    pull_policy: always
    container_name: agent-controller-worker
    environment:
${backendWorkerEnv}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - agent-controller-network
    restart: unless-stopped

  backend-agent-controller-scheduler:
    image: ghcr.io/forepath/agenstra-controller-api:latest
    pull_policy: always
    container_name: agent-controller-scheduler
    environment:
${backendSchedulerEnv}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - agent-controller-network
    restart: unless-stopped

  frontend-agent-console-server:
    image: ghcr.io/forepath/agenstra-console-server:latest
    pull_policy: always
    container_name: agent-console-server
    command: ['/bin/sh', '-c', 'CONFIG=https://${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'}:${config.proxy?.httpsPort ?? '443'}/config.json node server.cjs']
    environment:
${frontendEnv}
    ports:
      - '${config.frontend?.port ?? '4200'}:${config.frontend?.port ?? '4200'}'
    networks:
      - agent-controller-network
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    container_name: agent-controller-nginx
    ports:
      - '${config.proxy?.httpPort ?? '80'}:${config.proxy?.httpPort ?? '80'}'
      - '${config.proxy?.httpsPort ?? '443'}:${config.proxy?.httpsPort ?? '443'}'
      - '${config.proxy?.websocketPort ?? '8443'}:${config.proxy?.websocketPort ?? '8443'}'
    depends_on:
      - frontend-agent-console-server
      - backend-agent-controller
    volumes:
      - /opt/agent-controller/sites-enabled:/etc/nginx/conf.d:ro
      - /opt/agent-controller/ssl:/etc/nginx/ssl:ro
      - /opt/agent-controller/certbot-webroot:/var/www/certbot:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    networks:
      - agent-controller-network
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:

networks:
  agent-controller-network:
    driver: bridge
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
        proxy_pass http://agent-console-server:${config.frontend?.port ?? '4200'};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://agent-controller-api:${config.backend?.port ?? '3100'};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /${config.backend?.websocketNamespace ?? 'websocket'} {
        proxy_pass http://agent-controller-api:${config.backend?.websocketPort ?? '8081'};
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
        proxy_pass http://agent-controller-api:${config.backend?.websocketPort ?? '8081'};
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
        proxy_pass http://agent-console-server:${config.frontend?.port ?? '4200'};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://agent-controller-api:${config.backend?.port ?? '3100'};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /${config.backend?.websocketNamespace ?? 'websocket'} {
        proxy_pass http://agent-controller-api:${config.backend?.websocketPort ?? '8081'};
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
        proxy_pass http://agent-controller-api:${config.backend?.websocketPort ?? '8081'};
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

# Cloud-init user-data script for agent-controller provisioning
# This script is executed by cloud-init during server initialization

# Logging function
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a /var/log/agent-controller-provisioning.log
}

log "Starting server provisioning script (cloud-init user-data)"

# Ensure network is ready (cloud-init should have this ready, but we verify)
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

# Update system
export DEBIAN_FRONTEND=noninteractive
log "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

# Install openssh server
log "Installing openssh server..."
apt-get install -y openssh-server ssh

# Add SSH public key
log "Adding SSH public key..."
mkdir -p /root/.ssh
echo "${config.ssh?.publicKey ?? ''}" > /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

# Configure SSH server
log "Configuring SSH server..."
cat > /etc/ssh/sshd_config <<'EOF'
${sshConfig}
EOF
service ssh restart

# Set SSH password permanently
log "Setting SSH password permanently..."
chage -d 1 -m 0 -M 99999 -I -1 -E -1 root

# Install Docker using the convenience script
# Official method: https://docs.docker.com/engine/install/ubuntu/#install-using-the-convenience-script
log "Installing prerequisites for Docker installation..."
apt-get update -qq
apt-get install -y ca-certificates curl

log "Installing Docker using convenience script..."
curl -fsSL https://get.docker.com -o get-docker.sh
sh ./get-docker.sh
rm -f get-docker.sh

# Start and enable Docker service
log "Starting Docker service..."
systemctl enable docker
systemctl start docker

# Wait for Docker to be ready and verify it's working
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

# Verify Docker is working
if ! docker info > /dev/null 2>&1; then
    log "ERROR: Docker is not working properly"
    exit 1
fi

# Create directory for agent-controller
log "Creating agent-controller directory..."
mkdir -p /opt/agent-controller

# Create nginx sites-enabled directory
log "Creating nginx sites-enabled directory..."
mkdir -p /opt/agent-controller/sites-enabled

# Create nginx configuration file
log "Creating nginx configuration file..."
cat > /opt/agent-controller/sites-enabled/default.conf <<'EOF'
${nginxBootstrapConfig}
EOF

# Create nginx ssl directory
log "Creating nginx ssl directory..."
mkdir -p /opt/agent-controller/ssl

# Generate bootstrap SSL certificate for nginx before Let's Encrypt is available
log "Generating bootstrap SSL certificate..."
mkdir -p /opt/agent-controller/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /opt/agent-controller/ssl/bootstrap.key \
    -out /opt/agent-controller/ssl/bootstrap.crt \
    -subj "/C=DE/ST=Nordrhein-Westfalen/L=Herford/O=Agenstra/CN=${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'}" \
    -addext "subjectAltName=DNS:${config.host?.fqdn ?? config.host?.hostname ?? 'localhost'}" 2>/dev/null || {
    log "WARNING: Failed to generate bootstrap SSL certificate, nginx may not start properly"
}

chmod 600 /opt/agent-controller/ssl/bootstrap.key
chmod 644 /opt/agent-controller/ssl/bootstrap.crt

# Create docker-compose.yaml file
log "Creating docker-compose.yaml file..."
cat > /opt/agent-controller/docker-compose.yaml <<'EOF'
${dockerCompose}
EOF

# Start agent-controller container
log "Starting agent-controller container..."
cd /opt/agent-controller
docker compose up -d || {
    log "ERROR: Failed to start agent-controller container"
    docker compose logs || true
    exit 1
}

${buildCertbotBootstrapScript({
  stackName: 'agent-controller',
  stackDir: '/opt/agent-controller',
  nginxContainerName: 'agent-controller-nginx',
  fqdn: config.host?.fqdn ?? config.host?.hostname ?? 'localhost',
  letsEncryptEmail: process.env.LETS_ENCRYPT_EMAIL,
  letsEncryptNginxConfig: nginxLetsEncryptConfig,
})}

log "agent-controller provisioning completed successfully at $(date)"
`;

  return Buffer.from(script).toString('base64');
}

const AGENT_CONTROLLER_UPDATE_LOG = '/var/log/agent-controller-update.log';

/**
 * Builds the shell command to run on a provisioned agent-controller host to pull latest images
 * and recreate containers (docker compose up -d --pull=always). Logs to agent-controller-update.log.
 * Use when executing updates over SSH from the billing scheduler.
 */
export function buildAgentControllerUpdateCommand(): string {
  return `log() { echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a ${AGENT_CONTROLLER_UPDATE_LOG}; }; log "Starting update"; cd /opt/agent-controller && docker compose up -d --pull=always 2>&1 | tee -a ${AGENT_CONTROLLER_UPDATE_LOG} || { log "ERROR: Update failed"; exit 1; }; log "Update completed"`;
}

export {
  buildAgentControllerCloudInitUserData as buildBillingCloudInitUserData,
  buildAgentControllerCloudInitConfigFromRequest as buildCloudInitConfigFromRequest,
};
export type CloudInitConfig = AgentControllerCloudInitConfig;
