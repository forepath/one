# Platform Authentication (Keycloak)

This directory contains the Keycloak setup for the platform authentication service.

## Quick Start

Start Keycloak using Docker Compose:

```bash
docker compose up -d
```

Keycloak will be available at `http://localhost:8380`

- Admin Console: `http://localhost:8380/admin`
- Username: `admin`
- Password: `admin`

## Configure CSP for Framing

By default, Keycloak prevents framing to protect against clickjacking attacks. For development, you can configure Keycloak to allow framing from any origin.

### Option 1: Automatic Configuration (Recommended for Development)

Run the configuration script after Keycloak starts:

```bash
# Wait for Keycloak to be ready (about 30 seconds), then run:
KEYCLOAK_URL=http://localhost:8380 \
ADMIN_USERNAME=admin \
ADMIN_PASSWORD=admin \
REALM_NAME=agenstra \
./configure-keycloak-csp.sh
```

### Option 2: Manual Configuration via Admin Console

1. Open Keycloak Admin Console: `http://localhost:8380/admin`
2. Login with admin credentials (admin/admin)
3. Select your realm (e.g., `agenstra`)
4. Go to **Realm Settings** > **Security Defenses** > **Headers** tab
5. Find the **Content-Security-Policy** field
6. Update it to allow framing:
   ```
   frame-src 'self'; frame-ancestors *; object-src 'none';
   ```
7. Click **Save**

### Option 3: Configure for Specific Origins (Production)

For production, instead of allowing all origins (`*`), specify allowed origins:

```
frame-src 'self'; frame-ancestors 'self' https://your-app-domain.com https://another-domain.com; object-src 'none';
```

## Environment Variables

The following environment variables can be configured in `docker-compose.yml`:

- `KC_BOOTSTRAP_ADMIN_USERNAME` - Admin username (default: `admin`)
- `KC_BOOTSTRAP_ADMIN_PASSWORD` - Admin password (default: `admin`)
- `KC_HOSTNAME_STRICT` - Disable strict hostname checking (default: `false` for development)
- `KC_HOSTNAME_STRICT_HTTPS` - Disable strict HTTPS hostname checking (default: `false` for development)

## Security Notes

⚠️ **Warning**: Allowing framing from any origin (`frame-ancestors *`) is a security risk and should only be used in development environments. In production:

1. Configure CSP to allow framing only from trusted origins
2. Use HTTPS for all connections
3. Enable strict hostname checking
4. Regularly review and update CSP settings

## Troubleshooting

### CSP Error: "frame-ancestors 'self'"

If you see this error, Keycloak's CSP is blocking framing. Run the configuration script or configure CSP manually via Admin Console.

### Keycloak Not Ready

If the configuration script fails, wait a bit longer for Keycloak to fully initialize (it may take 30-60 seconds), then run the script again.

### Script Requires jq

The script uses `jq` for JSON processing. If `jq` is not available, install it:

- macOS: `brew install jq`
- Linux: `apt-get install jq` or `yum install jq`
- Or configure CSP manually via Admin Console
