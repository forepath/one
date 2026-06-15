# Debugging Guide

Debugging strategies and tools for troubleshooting Agenstra issues.

## Logging

### Application Logs

View application logs:

```bash
# Backend Agent Controller
nx serve agenstra-backend-agent-controller
# Logs appear in console

# Backend Agent Manager
nx serve agenstra-backend-agent-manager
# Logs appear in console

# Docker containers
docker compose logs -f api
```

### Log Levels

Configure log levels via environment variables:

- `LOG_LEVEL=debug` - Detailed debugging information
- `LOG_LEVEL=info` - General information
- `LOG_LEVEL=warn` - Warnings
- `LOG_LEVEL=error` - Errors only

### Log Analysis

Common log patterns to look for:

- **Connection errors**: Database, WebSocket, HTTP
- **Authentication errors**: Invalid tokens, expired credentials
- **Container errors**: Docker operations, container lifecycle
- **Rate limiting**: 429 errors, limit exceeded

## Debugging Tools

### Browser DevTools

- **Network Tab**: Monitor HTTP requests and WebSocket connections
- **Console Tab**: View JavaScript errors and logs
- **Application Tab**: Check storage, cookies, and service workers

### Docker Debugging

```bash
# View container logs
docker logs <container-name>

# Execute commands in container
docker exec -it <container-name> /bin/sh

# Inspect container
docker inspect <container-name>

# View container stats
docker stats <container-name>
```

### Database Debugging

```bash
# Connect to database
psql -h localhost -U postgres -d agent_controller

# View tables
\dt

# Query data
SELECT * FROM clients;

# View logs
tail -f /var/log/postgresql/postgresql.log
```

## Common Debugging Scenarios

### WebSocket Connection Issues

1. Check WebSocket URL is correct
2. Verify WebSocket server is running
3. Check browser console for errors
4. Review WebSocket connection logs
5. Test WebSocket connection manually

### Authentication Problems

1. Verify API key or token is valid
2. Check token expiration
3. Review authentication logs
4. Test authentication manually
5. Verify Keycloak configuration

### Container Issues

1. Check Docker daemon is running
2. Verify Docker socket permissions
3. Review container logs
4. Inspect container configuration
5. Test container creation manually

## Performance Debugging

### Application Performance

- Monitor API response times
- Check database query performance
- Review WebSocket message latency
- Analyze container resource usage

### Database Performance

- Check slow query log
- Analyze query execution plans
- Monitor database connections
- Review index usage

### Network Performance

- Monitor network latency
- Check WebSocket message throughput
- Analyze HTTP request/response times
- Review connection pooling

## Network Debugging

### Test HTTP Endpoints

```bash
# Test API endpoint
curl http://localhost:3100/api/clients

# Test with authentication
curl -H "Authorization: Bearer <token>" http://localhost:3100/api/clients
```

### Test WebSocket Connection

```bash
# Using wscat
wscat -c ws://localhost:8081/clients

# Send event
{"event":"setClient","data":{"clientId":"client-uuid"}}
```

## Related Documentation

- **[Common Issues](./common-issues.md)** - Common problems and solutions
- **[Deployment Guide](../deployment/README.md)** - Deployment troubleshooting

---

_For specific issues, see the [Common Issues](./common-issues.md) guide._
