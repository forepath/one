# Production Deployment Checklist

Comprehensive checklist for deploying Agenstra to production.

## Pre-Deployment Checklist

### Environment Configuration

- `NODE_ENV=production` is set for all applications
- `CORS_ORIGIN` is configured with your production domain(s)
- `RATE_LIMIT_ENABLED=true` (or leave unset, defaults to `true` in production)
- `RATE_LIMIT_LIMIT` is set to an appropriate value for your use case
- `STATIC_API_KEY` or Keycloak credentials are configured
- Database credentials are secure and not using defaults
- `ENCRYPTION_KEY` is set for sensitive data encryption (agent-controller)
- **Backend agent-controller**: `CLIENT_ENDPOINT_ALLOWED_HOSTS` is set (comma-separated hostnames or `*`); the process exits on startup in production if unset (see [Environment configuration](./environment-configuration.md))

### Security

- All default passwords are changed
- API keys are strong and unique
- Keycloak is properly configured (if using)
- HTTPS/WSS is enabled for all connections
- CORS is restricted to specific origins
- Rate limiting is enabled
- Database connections use SSL/TLS
- Docker socket permissions are restricted (if applicable); API images run as non-root `agenstra` with socket GID sync at startup
- `agenstra` has **no** full `sudo` access (only allowlisted commands in `/etc/sudoers.d/agenstra`; see [Container image security](../security/container-images.md#restricted-sudo))
- Host `/opt/agents` exists and is writable by container UID **10001** (or relies on entrypoint `chown` after bind mount)
- Manager **API, worker, VNC, SSH, and agi (OpenClaw)** images are upgraded together on the same release tag
- Image `DOCKER_GID` matches host `docker` group GID when building manager/controller API images (see [Docker deployment](./docker-deployment.md#container-security-images))

### Database

- PostgreSQL is configured with proper credentials
- Database backups are configured
- Database connection pooling is optimized
- Database migrations are tested
- Database indexes are optimized

### Infrastructure

- Docker is properly configured
- Docker socket is securely mounted (agent-manager); understand host-level privilege implications
- Container images use non-root users; secrets supplied at deploy time, not baked into images
- Container resource limits are set (see **[System Requirements](./system-requirements.md)**)
- Logging is configured
- Monitoring is set up
- Health checks are configured

## Security Considerations

### Authentication

- Use strong API keys or Keycloak with proper configuration
- Consider setting **`AUTHENTICATION_METHOD`** explicitly in production if your policy requires fully unambiguous mode selection (see **[Accepted risks - AR-003](../security/accepted-risks.md)**)
- Enable token expiration and refresh
- Implement proper session management
- Use HTTPS for all API communications

### Network Security

- Restrict CORS to specific origins
- Use firewall rules to restrict access
- Enable rate limiting
- Monitor for suspicious activity

### Data Protection

- Encrypt sensitive data at rest
- Use secure database connections
- Protect credentials and API keys
- Implement proper access controls

## Performance Optimization

### Database

- Configure connection pooling
- Optimize database queries
- Add appropriate indexes
- Monitor query performance

### Application

- Enable production mode optimizations
- Configure caching where appropriate
- Optimize container resource allocation
- Monitor application performance

### Network

- Use CDN for frontend assets
- Enable HTTP/2
- Configure proper timeouts
- Monitor network latency

## Monitoring Setup

### Application Monitoring

- Set up application performance monitoring (APM)
- Configure error tracking
- Monitor API response times
- Track WebSocket connection health

### Infrastructure Monitoring

- Monitor container resource usage
- Track database performance
- Monitor network traffic
- Set up alerting

### Logging

- Centralize logs
- Configure log rotation
- Set up log aggregation
- Monitor for errors

## Backup Strategies

### Database Backups

- Configure automated database backups
- Test backup restoration
- Store backups securely
- Set up backup retention policies

### Configuration Backups

- Backup environment configurations
- Version control configuration files
- Document configuration changes
- Test configuration restoration

## Deployment Process

1. **Pre-deployment**
   - Review and test all changes
   - Run full test suite
   - Check security vulnerabilities
   - Review configuration

2. **Deployment**
   - Deploy to staging first
   - Test staging deployment
   - Deploy to production
   - Monitor deployment

3. **Post-deployment**
   - Verify all services are running
   - Check health endpoints
   - Monitor logs for errors
   - Test critical functionality

## Rollback Plan

- Document rollback procedures
- Test rollback process
- Keep previous versions available
- Have rollback scripts ready

## Related Documentation

- **[Docker Deployment](./docker-deployment.md)** - Containerized deployment
- **[Environment Configuration](./environment-configuration.md)** - Environment variables
- **[Troubleshooting](../troubleshooting/README.md)** - Problem-solving guides

---

_For detailed deployment information, see the [Docker Deployment](./docker-deployment.md) guide._
