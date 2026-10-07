# Contributing to This Framework

Thank you for your interest in contributing to this framework! This document provides guidelines and information for contributors.

## How to Contribute

We welcome contributions of all kinds:

- **Bug Reports** - Help us identify and fix issues
- **Feature Requests** - Suggest new functionality
- **Documentation** - Improve guides and references
- **Code Contributions** - Fix bugs or add features
- **Testing** - Improve test coverage and quality
- **Design** - Enhance user experience and visual design

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [Git](https://git-scm.com/)
- [Docker](https://docs.docker.com/get-docker/) (for MCP servers)

### Development Setup

1. **Fork and Clone**

   ```bash
   git clone https://github.com/your-username/one.git
   cd one
   ```

2. **Install Dependencies**

   ```bash
   npm install
   ```

3. **Verify Setup**

   ```bash
   nx --version
   nx prepush
   ```

4. **Review project setup and structure**
   - Run through local setup and run the app (see [project docs](./docs/agenstra/README.md) for entry points)
   - Understand the repository layout and how to run tests and builds

### Local Containers and Disk Usage

Run an application's local stack with `npx nx run <project>:start-containers`.
The following 13 applications expose this target and build 14 local test images.
Image names below use `ghcr.io/forepath/` and `:latest`, except for the manager's
worker, which uses `registry.forenet.internal/forepath/agenstra-manager-worker:test`.

| Project                                                                                  | Test image name(s)                                | Build prerequisite | Image usage                                                |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------ | ---------------------------------------------------------- |
| [agenstra-backend-agent-controller](apps/agenstra/backend-agent-controller/project.json) | `agenstra-controller-api`                         | `prune`            | API, scheduler, and worker Compose services                |
| [agenstra-backend-agent-manager](apps/agenstra/backend-agent-manager/project.json)       | `agenstra-manager-api`, `agenstra-manager-worker` | `prune`            | API Compose service; worker containers created dynamically |
| [agenstra-frontend-agent-console](apps/agenstra/frontend-agent-console/project.json)     | `agenstra-console-server`                         | `server`           | Console server                                             |
| [agenstra-frontend-billing-console](apps/agenstra/frontend-billing-console/project.json) | `agenstra-billing-console-server`                 | `server`           | Billing console server                                     |
| [agenstra-frontend-docs](apps/agenstra/frontend-docs/project.json)                       | `agenstra-docs-server`                            | `postbuild`        | Documentation server                                       |
| [agenstra-frontend-landingpage](apps/agenstra/frontend-landingpage/project.json)         | `agenstra-landingpage-server`                     | `postbuild`        | Landing page server                                        |
| [decabill-backend-billing-manager](apps/decabill/backend-billing-manager/project.json)   | `decabill-billing-api`                            | `prune`            | API, scheduler, and worker Compose services                |
| [decabill-frontend-billing-console](apps/decabill/frontend-billing-console/project.json) | `decabill-billing-console-server`                 | `server`           | Billing console server                                     |
| [decabill-frontend-docs](apps/decabill/frontend-docs/project.json)                       | `decabill-docs-server`                            | `postbuild`        | Documentation server                                       |
| [decabill-frontend-landingpage](apps/decabill/frontend-landingpage/project.json)         | `decabill-landingpage-server`                     | `postbuild`        | Landing page server                                        |
| [forepath-backend-communication](apps/forepath/backend-communication/project.json)       | `forepath-communication-api`                      | `prune`            | API Compose service                                        |
| [forepath-frontend-billing-console](apps/forepath/frontend-billing-console/project.json) | `forepath-billing-console-server`                 | `server`           | Billing console server                                     |
| [forepath-frontend-landingpage](apps/forepath/frontend-landingpage/project.json)         | `forepath-landingpage-server`                     | `postbuild`        | Landing page server                                        |

All image targets use `@nx-tools/nx-container:build`, default to the `test`
configuration, disable Nx caching, pass the `VERSION` build argument, and load
the result into the local Docker image store with `load: true`. Docker layer
caching still applies. The build paths are:

- Backends: `prune` prepares the compiled app, pruned dependencies, and workspace
  modules under `dist/apps/<domain>/<app>`. It is an Nx packaging target, not
  Docker cleanup. API Dockerfiles use Debian, install the runtime and production
  dependencies, copy the app, and launch `main.js` through an entrypoint. Agenstra
  and Decabill also prepare migrations and provider-plugin installation assets.
- Agent and billing consoles: `server` follows `prebuild-server` and prepares
  `dist/apps/<domain>/<app>/server`. Node Alpine images install production
  dependencies, copy the server output, and launch `server.cjs`. All three billing
  consoles share Decabill's Dockerfile and Compose definition; environment
  variables select the appropriate image and container name.
- Landing pages and documentation: `postbuild` follows `build` and
  `build-delegating-server`, assembling `dist/apps/<domain>/<app>/server`.
  Node Alpine images copy that output and launch `server.mjs`. Both documentation
  apps share the documentation Dockerfile and Compose definition, with
  environment variables selecting their image and container name.
- Manager worker: a separate Debian image installs the desktop, development
  tools, and OpenCode, and copies `worker-desktop` assets from the manager's build
  output. Compose does not start this image. The manager's Docker service creates
  agent containers from `AGENT_DEFAULT_IMAGE`, whose Compose default is
  `ghcr.io/forepath/agenstra-manager-worker:latest`. To use the locally built test
  worker, explicitly set it to the internal-registry `:test` reference above.

Compose uses `pull_policy: never` for the application services and runs
`up -d --force-recreate --remove-orphans`. Infrastructure images such as
PostgreSQL, Redis, OpenSearch, and MailHog are separate pulled images.

Repeated starts do not necessarily create new image IDs: an unchanged Docker
build can reuse its cached image. However, a changed build moves the fixed tag to
a new image, leaving the previous image dangling once the old containers are
recreated. Compose's `--remove-orphans` removes containers, not images. Without
cleanup, these obsolete images can accumulate; this was reproduced with Docker.

Each test image now carries `io.forepath.one.test-project=<project>`. After a
successful Compose start, the target runs:

```bash
docker image prune --force --filter label=io.forepath.one.test-project=<project>
```

Without `--all`, this removes only that project's dangling, unused test images.
Tagged images, images referenced by running or stopped containers, other
projects' images, release images, and volumes are preserved. Failed starts and
standalone image builds do not run cleanup; a later successful start can reclaim
their obsolete labeled images. Release builds remain unlabeled and unchanged.

Images built before labeling cannot be safely attributed to a project by this
cleanup. Inspect `docker system df -v` and `docker image ls --filter dangling=true`
before manually removing specific legacy image IDs. No global prune runs
automatically. BuildKit cache is separate and may retain shared layers even after
an image is removed. Inspect it with `docker buildx du`; opt-in maintenance such
as `docker buildx prune --filter until=168h` removes old unused cache but can
affect rebuild speed for other projects using the same builder.

## Development Guidelines

### Code Quality Standards

- Follow the project’s code quality and security practices
- Use conventional commits for commit messages (e.g. `feat:`, `fix:`, `docs:`)
- Ensure all tests pass and code is properly formatted

### Architecture Guidelines

- Respect application and library boundaries
- Follow domain and dependency rules
- Use Nx for all build, test, and lint tasks

### Nx Workflow

- Use `nx` commands for all operations
- Run `nx affected` to test only changed projects
- Use `nx format:write` for code formatting
- Run `nx prepush` before committing

## Contribution Workflow

### 1. Planning

- Check existing issues and discussions
- Create an issue for significant changes
- Discuss your approach with maintainers if needed

### 2. Development

- Create a feature branch from `main`
- Follow our development guidelines
- Write tests for new functionality
- Update documentation as needed

### 3. Testing

- Run the full test suite: `nx prepush`
- Test affected projects: `nx affected -t test,build,lint`
- Verify your changes work as expected

### 4. Submission

- Create a pull request using our template
- Ensure all checklist items are completed
- Request review from maintainers

## Pull Request Guidelines

### Before Submitting

- [ ] All tests pass locally
- [ ] Code follows style guidelines
- [ ] Documentation is updated
- [ ] Commit messages follow conventional format
- [ ] PR description is complete

### PR Requirements

- Use our [Pull Request Template](./.github/PULL_REQUEST_TEMPLATE.md)
- Include tests for new functionality
- Update relevant documentation
- Follow the project’s contribution and workflow guidelines

## Bug Reports

When reporting bugs, please:

1. Use our [Bug Report Template](./.github/ISSUE_TEMPLATE/bug_report.md)
2. Include steps to reproduce
3. Provide environment information
4. Add screenshots if applicable
5. Check existing issues first

## Feature Requests

For feature requests:

1. Use our [Feature Request Template](./.github/ISSUE_TEMPLATE/feature_request.md)
2. Describe the problem and proposed solution
3. Consider impact on existing functionality
4. Check our roadmap and existing discussions

## Documentation Contributions

We value documentation improvements:

- Fix typos and clarify explanations
- Add missing examples
- Improve structure and navigation
- Translate content (contact us first)

## Testing Guidelines

- Write unit tests for new functionality
- Add integration tests for complex features
- Ensure test coverage doesn't decrease
- Use descriptive test names

## Code Style

- Follow TypeScript best practices
- Use Prettier for formatting
- Follow ESLint rules
- Write self-documenting code

## Security

- Don't include sensitive information in issues or PRs
- Report security vulnerabilities via the [Vulnerability Disclosure Policy](https://forepath.io/legal/vulnerability-disclosure) form or soc@forepath.io
- Follow responsible disclosure practices (see [SECURITY.md](./SECURITY.md) and the public VDP)
- **There is no official bug bounty program!** Rewards are discretionary only; automated or AI-generated reports are discarded without review

## Getting Help

### Community Support

- [GitHub Discussions](https://github.com/forepath/one/discussions)
- [Project overview and docs](./docs/agenstra/README.md)
- [Issue Tracker](https://github.com/forepath/one/issues)

### Direct Support

- **General Questions**: hi@forepath.io
- **Bug Reports**: support@forepath.io
- **Enterprise**: hi@forepath.io
- **Security**: [Vulnerability Disclosure Policy](https://forepath.io/legal/vulnerability-disclosure) or soc@forepath.io

## Recognition

Contributors will be recognized in:

- Release notes for significant contributions
- Contributors section in the project
- Special mentions for exceptional contributions

## License

By contributing to this framework, you agree that your contributions will be licensed under the MIT or respective sub-license.

## Thank You

Your contributions help make this framework better for everyone. We appreciate your time and effort!

---

**Questions about contributing?** Contact us at hi@forepath.io
