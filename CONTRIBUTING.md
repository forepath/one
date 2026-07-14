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
- Report security vulnerabilities to soc@forepath.io
- Follow responsible disclosure practices (see [SECURITY.md](./SECURITY.md))
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
- **Security**: soc@forepath.io

## Recognition

Contributors will be recognized in:

- Release notes for significant contributions
- Contributors section in the project
- Special mentions for exceptional contributions

## License

By contributing to this framework, you agree that your contributions will be licensed under the MIT License.

## Thank You

Your contributions help make this framework better for everyone. We appreciate your time and effort!

---

**Questions about contributing?** Contact us at hi@forepath.io
