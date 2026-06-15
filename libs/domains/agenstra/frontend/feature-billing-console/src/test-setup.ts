import '@angular/localize/init';
import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';

// Mock Keycloak to avoid ES module import issues when testing components that use data-access-agent-console
jest.mock('keycloak-angular', () => ({
  KeycloakService: jest.fn(),
}));

setupZoneTestEnv();
