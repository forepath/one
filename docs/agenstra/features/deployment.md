# Deployment and CI/CD Integration

This feature enables deployment functionality and CI/CD pipeline management for agents. It allows you to configure CI/CD providers (GitHub Actions and GitLab CI/CD), trigger pipeline runs, monitor their status, and view logs directly from the Agenstra console.

## Overview

The deployment feature provides:

- **CI/CD Provider Configuration** - Configure GitHub Actions or GitLab CI/CD (or other providers) for each agent
- **Pipeline Management** - List, trigger, and monitor CI/CD pipeline runs
- **Log Viewing** - View pipeline run logs and individual job/step logs
- **Run History** - Track deployment history and status

## Architecture

The deployment feature follows the same provider pattern used throughout Agenstra:

- **PipelineProvider Interface** - Unified interface for CI/CD providers
- **Pipeline provider registry** — `PIPELINE_PROVIDER_REGISTRY` from `AgenstraPluginHostModule`; resolves GitHub/GitLab pipeline providers by type
- **Provider Implementations** - GitHub Actions and GitLab CI/CD providers (extensible to Jenkins, Azure DevOps, etc.)
- **Deployment Service** - Orchestrates pipeline operations
- **Database Storage** - Stores deployment configurations and run history

See the application and deployment docs for detailed component relationships.

## Supported Providers

### GitHub Actions

The GitHub provider supports:

- **Repository Management** - List accessible repositories
- **Branch Management** - List branches for repositories
- **Workflow Management** - List workflows/pipelines for repositories
- **Run Triggering** - Trigger workflow runs manually
- **Status Tracking** - Get real-time status of pipeline runs
- **Log Viewing** - View logs for runs and individual jobs
- **Run Cancellation** - Cancel running pipelines

**Authentication**: Uses GitHub Personal Access Tokens (PAT) or GitHub App tokens. The token is stored in the database as part of the deployment configuration and is encrypted at rest.

**Base URL**: The base URL for GitHub Enterprise Server can be configured per agent via the `providerBaseUrl` field in the deployment configuration. If not specified, defaults to `https://api.github.com`.

### GitLab CI/CD

The GitLab provider supports:

- **Repository Management** - List accessible projects (repositories)
- **Branch Management** - List branches for projects
- **Pipeline Management** - List and trigger CI/CD pipelines
- **Run Triggering** - Trigger pipeline runs manually with variables
- **Status Tracking** - Get real-time status of pipeline runs
- **Log Viewing** - View logs for runs and individual jobs
- **Run Cancellation** - Cancel running pipelines

**Authentication**: Uses GitLab Personal Access Tokens (PAT). The token is stored in the database as part of the deployment configuration and is encrypted at rest.

**Base URL**: The base URL for self-hosted GitLab instances can be configured per agent via the `providerBaseUrl` field in the deployment configuration. If not specified, defaults to `https://gitlab.com/api/v4`.

**Repository ID Format**: GitLab uses project paths (e.g., `group/project`) or numeric project IDs. The provider automatically handles URL encoding for project paths.

**Self-Hosted GitLab**: When using a self-hosted GitLab instance, provide the base URL (e.g., `https://gitlab.example.com`). The provider will automatically append `/api/v4` if needed.

## Configuration

### Agent-Level Configuration

Deployment configuration can be set when creating or updating an agent:

```json
{
  "name": "My Agent",
  "deploymentConfiguration": {
    "providerType": "github",
    "repositoryId": "owner/repo",
    "defaultBranch": "main",
    "workflowId": "12345678",
    "providerToken": "ghp_xxxxxxxxxxxx",
    "providerBaseUrl": "https://api.github.com"
  }
}
```

**GitLab Example**:

```json
{
  "name": "My Agent",
  "deploymentConfiguration": {
    "providerType": "gitlab",
    "repositoryId": "group/project",
    "defaultBranch": "main",
    "providerToken": "glpat-xxxxxxxxxxxx",
    "providerBaseUrl": "https://gitlab.com"
  }
}
```

**Self-Hosted GitLab Example**:

```json
{
  "name": "My Agent",
  "deploymentConfiguration": {
    "providerType": "gitlab",
    "repositoryId": "group/project",
    "defaultBranch": "main",
    "providerToken": "glpat-xxxxxxxxxxxx",
    "providerBaseUrl": "https://gitlab.example.com"
  }
}
```

### Standalone Configuration

You can also configure deployment separately using the deployment endpoints:

**Create/Update Configuration**:

```
POST /api/agents/:agentId/deployments/configuration
```

**Delete Configuration**:

```
DELETE /api/agents/:agentId/deployments/configuration
```

## API Endpoints

### Agent Manager Endpoints

All endpoints are prefixed with `/api/agents/:agentId/deployments`:

#### Configuration Management

- `GET /configuration` - Get deployment configuration
- `POST /configuration` - Create or update deployment configuration
- `DELETE /configuration` - Delete deployment configuration

#### Repository Operations

- `GET /repositories` - List accessible repositories
- `GET /repositories/:repositoryId/branches` - List branches for a repository
- `GET /repositories/:repositoryId/workflows` - List workflows for a repository (optional `?branch=name` query parameter)

#### Pipeline Operations

- `POST /workflows/trigger` - Trigger a workflow run
  ```json
  {
    "workflowId": "12345678",
    "ref": "main",
    "inputs": {
      "environment": "production"
    }
  }
  ```

#### Run Management

- `GET /runs` - List deployment runs (supports `limit` and `offset` query parameters)
- `GET /runs/:runId` - Get run status
- `GET /runs/:runId/logs` - Get run logs
- `GET /runs/:runId/jobs` - List jobs/steps for a run
- `GET /runs/:runId/jobs/:jobId/logs` - Get logs for a specific job
- `POST /runs/:runId/cancel` - Cancel a running pipeline

### Agent Controller Proxy Endpoints

All endpoints are prefixed with `/api/clients/:clientId/agents/:agentId/deployments`:

The agent-controller provides proxy endpoints that forward requests to the appropriate agent-manager instance. All endpoints mirror the agent-manager endpoints but are prefixed with the client ID.

## Usage Examples

### Configure GitHub Actions for an Agent

```bash
curl -X POST http://localhost:3000/api/agents/{agentId}/deployments/configuration \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "providerType": "github",
    "repositoryId": "myorg/myrepo",
    "defaultBranch": "main",
    "workflowId": "12345678",
    "providerToken": "ghp_xxxxxxxxxxxx"
  }'
```

### Configure GitLab CI/CD for an Agent

```bash
curl -X POST http://localhost:3000/api/agents/{agentId}/deployments/configuration \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "providerType": "gitlab",
    "repositoryId": "mygroup/myproject",
    "defaultBranch": "main",
    "providerToken": "glpat-xxxxxxxxxxxx"
  }'
```

### Configure Self-Hosted GitLab for an Agent

```bash
curl -X POST http://localhost:3000/api/agents/{agentId}/deployments/configuration \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "providerType": "gitlab",
    "repositoryId": "mygroup/myproject",
    "defaultBranch": "main",
    "providerToken": "glpat-xxxxxxxxxxxx",
    "providerBaseUrl": "https://gitlab.example.com"
  }'
```

### List Repositories

```bash
curl http://localhost:3000/api/agents/{agentId}/deployments/repositories \
  -H "Authorization: Bearer {token}"
```

### Trigger a Workflow

```bash
curl -X POST http://localhost:3000/api/agents/{agentId}/deployments/workflows/trigger \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "workflowId": "12345678",
    "ref": "main",
    "inputs": {
      "environment": "production"
    }
  }'
```

### Get Run Status

```bash
curl http://localhost:3000/api/agents/{agentId}/deployments/runs/{runId} \
  -H "Authorization: Bearer {token}"
```

### Get Run Logs

```bash
curl http://localhost:3000/api/agents/{agentId}/deployments/runs/{runId}/logs \
  -H "Authorization: Bearer {token}"
```

## Security

### Credential Storage

- Provider tokens are encrypted at rest using AES-256-GCM encryption
- Tokens are stored in the `deployment_configurations` table with encryption transformer
- Encryption key is configured via `ENCRYPTION_KEY` environment variable (base64-encoded 32-byte key)

### Authentication

- All endpoints require authentication (Keycloak JWT or API key)
- Provider tokens are never returned in API responses
- Tokens are only used internally for provider API calls

## Database Schema

### deployment_configurations

Stores CI/CD provider configuration per agent:

- `id` (UUID) - Primary key
- `agent_id` (UUID) - Foreign key to agents table
- `provider_type` (VARCHAR) - Provider type (e.g., 'github')
- `repository_id` (VARCHAR) - Repository identifier
- `default_branch` (VARCHAR) - Default branch name
- `workflow_id` (VARCHAR) - Workflow/pipeline identifier
- `provider_token` (VARCHAR, encrypted) - Provider API token
- `provider_base_url` (VARCHAR) - Optional base URL for self-hosted instances
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)

### deployment_runs

Stores pipeline run history:

- `id` (UUID) - Primary key
- `configuration_id` (UUID) - Foreign key to deployment_configurations table
- `provider_run_id` (VARCHAR) - Provider-specific run identifier
- `run_name` (VARCHAR) - Run name/title
- `status` (VARCHAR) - Run status (queued, in_progress, completed, cancelled, failure)
- `conclusion` (VARCHAR) - Run conclusion (success, failure, cancelled, skipped)
- `ref` (VARCHAR) - Git reference (branch, tag, or commit SHA)
- `sha` (VARCHAR) - Commit SHA
- `workflow_id` (VARCHAR) - Workflow identifier
- `workflow_name` (VARCHAR) - Workflow name
- `started_at` (TIMESTAMP) - When the run started
- `completed_at` (TIMESTAMP) - When the run completed
- `html_url` (TEXT) - HTML URL for viewing the run
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)

## Integration with Agent Creation/Update

Deployment configuration can be included when creating or updating agents:

**Create Agent with Deployment Configuration**:

```json
{
  "name": "My Agent",
  "description": "Agent with GitHub Actions",
  "deploymentConfiguration": {
    "providerType": "github",
    "repositoryId": "myorg/myrepo",
    "providerToken": "ghp_xxxxxxxxxxxx"
  }
}
```

**Update Agent Deployment Configuration**:

```json
{
  "deploymentConfiguration": {
    "repositoryId": "myorg/newrepo",
    "workflowId": "87654321"
  }
}
```

## Future Enhancements

- **Additional Providers**: Jenkins, Azure DevOps, CircleCI
- **Webhook Support**: Real-time updates via webhooks instead of polling
- **Deployment History Analytics**: Charts and metrics for deployment success rates
- **Rollback Capabilities**: Automatic rollback on failure
- **Environment Promotion**: Promote deployments across environments
- **Multi-Environment Support**: Manage deployments across multiple environments

## Related Documentation

- [Agent Management](./agent-management.md) - Agent lifecycle management
- [Server Provisioning](./server-provisioning.md) - Automated server provisioning
