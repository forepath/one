# Common Issues

Common problems and their solutions in the Agenstra system.

## Connection Issues

### Cannot Connect to Backend

**Symptoms**: Frontend cannot connect to backend API

**Solutions**:

- Verify backend is running: `nx serve agenstra-backend-agent-controller`
- Check API URL in frontend configuration: `API_URL=http://localhost:3100`
- Verify CORS configuration allows frontend origin
- Check firewall rules

### WebSocket Connection Fails

**Symptoms**: WebSocket connection fails or disconnects frequently

**Solutions**:

- Verify WebSocket URL: `WEBSOCKET_URL=http://localhost:3100/socket/clients`
- Check WebSocket port is not blocked
- Verify CORS allows WebSocket connections
- Check network connectivity

## Authentication Problems

### "Unauthorized" Errors

**Symptoms**: API requests return 401 Unauthorized

**Solutions**:

- Verify API key or Keycloak token is valid
- Check token expiration
- Verify authentication configuration
- Review authentication logs

### Keycloak Authentication Fails

**Symptoms**: Keycloak authentication not working

**Solutions**:

- Verify Keycloak server is running
- Check Keycloak configuration (URL, realm, client ID, secret)
- Verify Keycloak client is properly configured
- Check Keycloak logs

## Container Issues

### Editor terminal fails while agent container is running

**Symptoms**: `createTerminal` returns `TERMINAL_ERROR` but the agent container is up.

**Solutions**:

- Confirm OpenCode is healthy inside the worker (`GET /global/health` on the OpenCode port, default 4096).
- Redeploy the worker image if it predates OpenCode PTY support (`/pty` routes).
- Check agent-manager logs for OpenCode PTY create or WebSocket errors.

### Docker Socket Permission Denied

**Symptoms**: Agent-manager cannot access Docker socket

**Solutions**:

- Verify Docker socket permissions: `ls -l /var/run/docker.sock`
- Add user to docker group: `sudo usermod -aG docker $USER`
- Restart Docker service
- Check Docker socket mount in docker-compose.yaml

### Agent Container Creation Fails

**Symptoms**: Cannot create agent containers

**Solutions**:

- Verify Docker is running: `docker ps`
- Check Docker socket is mounted
- Review container logs
- Verify agent image is available
- Check container resource limits

### Sandboxed isolation level unavailable or creation rejected

**Symptoms**: The **Sandboxed (gVisor)** option is disabled in the create environment dialog; creation fails with `409 Conflict`, `503 Service Unavailable`, or "The sandboxed (gVisor) container could not be started"

**Solutions**:

- Check the reason code: `GET /api/clients/:id/isolation` (or `GET /api/isolation` on the manager)
- `E_RUNTIME_NOT_REGISTERED`: prepare the host (`sudo apps/agenstra/backend-agent-manager/host/agenstra-gvisor.sh check` / `install`), verify `docker info --format '{{json .Runtimes}}'` lists `runsc-systrap` (or your `AGENT_SANDBOX_RUNTIME`), then **Re-check isolation**
- `E_DISABLED_BY_ADMIN`: `AGENT_ISOLATION_SANDBOX_ENABLED=false` on the manager
- `409` on creation: the host capabilities changed while the dialog was open (stale revision) or the level is no longer ready; reopen the dialog and confirm the level again
- `503` on creation: the standard `runc` baseline failed (`E_DOCKER_BASELINE_UNAVAILABLE`, `E_RUNC_PROBE_FAILED`); check Docker and the worker image
- Sandboxed start failures are never retried on `runc`. Retry, or create the environment with the **standard** level if the workload needs features gVisor does not support (`io_uring`, KVM, Docker-in-Docker, in-sandbox `iptables`)
- See **[Container Isolation Levels](../features/container-isolation.md#troubleshooting)**

### Agent workspace permission errors

**Symptoms**: `git clone` fails in the worker container; permission denied writing under `/app` or `/home/agenstra/environment`; entrypoint `chown` failures

**Solutions**:

- Ensure host `/opt/agents` exists and is writable by UID **10001**, or allow the image entrypoint to `chown` the bind mount (rebuild worker images from a current release)
- Confirm manager API and worker images are on the **same release tag** Inspect ownership on the host: `ls -la /opt/agents/<volume-uuid>`
- See **[Container image security](../security/container-images.md#host-directory-ownership)**

## Database Issues

### Database Connection Fails

**Symptoms**: Cannot connect to database

**Solutions**:

- Verify PostgreSQL is running
- Check database credentials
- Verify database exists
- Check database connection string
- Review database logs

### Migration Errors

**Symptoms**: Database migrations fail

**Solutions**:

- Check database connection
- Verify database user has proper permissions
- Review migration logs
- Check for conflicting migrations
- Verify database schema

## WebSocket Problems

### Events Not Received

**Symptoms**: WebSocket events not reaching frontend

**Solutions**:

- Verify WebSocket connection is established
- Check client context is set
- Verify event forwarding is working
- Review WebSocket logs
- Check for reconnection issues

### Chat History Not Restored

**Symptoms**: Chat history not restored on reconnection

**Solutions**:

- Verify agent login is restored
- Check chat history is saved in database
- Review reconnection logic
- Check event clearing logic

## File Operation Errors

### Cannot Read Files

**Symptoms**: File read operations fail

**Solutions**:

- Verify agent container is running
- Check file path is correct
- Verify file permissions in container
- Review container logs

### Cannot Write Files

**Symptoms**: File write operations fail

**Solutions**:

- Verify agent container is running
- Check file permissions in container
- Verify container volume is writable
- Review container logs

## Rate Limiting Issues

### Too Many Requests Error

**Symptoms**: API returns 429 Too Many Requests

**Solutions**:

- Increase rate limit: `RATE_LIMIT_LIMIT=200`
- Increase time window: `RATE_LIMIT_TTL=120`
- Disable rate limiting in development: `RATE_LIMIT_ENABLED=false`
- Review rate limit configuration

## CORS Issues

### CORS Errors in Browser

**Symptoms**: CORS errors in browser console

**Solutions**:

- Verify `CORS_ORIGIN` is set correctly
- Check frontend origin matches CORS configuration
- Verify CORS is enabled in production
- Review CORS configuration

## Related documentation

- **[Debugging Guide](./debugging-guide.md)** Debugging strategies
- **[Container Isolation Levels](../features/container-isolation.md)** Sandboxed (gVisor) environments
- **[Deployment Guide](../deployment/README.md)** Deployment troubleshooting

---

_For more detailed debugging, see the [Debugging Guide](./debugging-guide.md)._
