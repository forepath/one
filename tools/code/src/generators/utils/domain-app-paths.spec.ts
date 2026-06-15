import { resolveDomainAppPaths } from './domain-app-paths';

describe('resolveDomainAppPaths', () => {
  it('builds forepath frontend paths with explicit domain', () => {
    expect(resolveDomainAppPaths('landingpage', 'frontend', { domain: 'forepath' }, 'agenstra')).toEqual({
      domain: 'forepath',
      roleName: 'frontend-landingpage',
      projectName: 'forepath-frontend-landingpage',
      appRoot: 'apps/forepath/frontend-landingpage',
    });
  });

  it('falls back to the generator default domain', () => {
    expect(resolveDomainAppPaths('devkit', 'mcp', {}, 'shared')).toEqual({
      domain: 'shared',
      roleName: 'mcp-devkit',
      projectName: 'shared-mcp-devkit',
      appRoot: 'apps/shared/mcp-devkit',
    });
  });

  it('builds native app paths under the selected domain', () => {
    expect(resolveDomainAppPaths('agent-console', 'native', { domain: 'agenstra' }, 'agenstra')).toEqual({
      domain: 'agenstra',
      roleName: 'native-agent-console',
      projectName: 'agenstra-native-agent-console',
      appRoot: 'apps/agenstra/native-agent-console',
    });
  });
});
