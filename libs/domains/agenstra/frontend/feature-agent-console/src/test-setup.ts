import '@angular/localize/init';
import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';

// Mock Keycloak to avoid ES module import issues when testing components that use data-access-agent-console
jest.mock('keycloak-js', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('keycloak-angular', () => ({
  KeycloakService: jest.fn(),
  createAuthGuard: jest.fn((impl: unknown) => impl),
}));

setupZoneTestEnv();
