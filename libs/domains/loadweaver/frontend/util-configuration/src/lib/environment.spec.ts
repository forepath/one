import { environment as developmentEnvironment } from './environment.landingpage';
import { environment as productionEnvironment } from './environment.landingpage.production';
import { environment as billingDevelopmentEnvironment } from './environment.billing-console';
import { environment as billingProductionEnvironment } from './environment.billing-console.production';
import { environment as consoleDevelopmentEnvironment } from './environment.console';
import { environment as consoleProductionEnvironment } from './environment.console.production';
import { createLoadweaverShell } from './shell';

describe('Loadweaver landing environments', () => {
  it.each([
    ['development', developmentEnvironment, false],
    ['production', productionEnvironment, true],
  ])('%s environment carries the Loadweaver shell', (_name, environment, production) => {
    expect(environment.application).toEqual({ production, productName: 'Loadweaver' });
    expect(environment.cookieConsent.domain).toBe('.loadweaver.com');
    expect(environment.cookieConsent.urls.privacyPolicy).toBe('https://loadweaver.com/legal/privacy');
    expect(environment.communication.urls.restApi).toMatch(/\/api$/);
    expect(environment.communication.turnstileSiteKey).not.toHaveLength(0);
    expect(environment.landing.urls.portal).toMatch(/^https?:\/\//);
  });

  it('serves the development social preview from the landing page port', () => {
    expect(developmentEnvironment.socialPreview.urls.image).toBe('http://localhost:4600/assets/images/og-preview.png');
  });

  it('builds the shell from the given options', () => {
    const shell = createLoadweaverShell({ production: true, socialPreviewImageUrl: 'https://example.com/og.png' });

    expect(shell.socialPreview.urls.image).toBe('https://example.com/og.png');
    expect(shell.authentication.marketing.features.length).toBeGreaterThan(0);
  });

  it.each([
    ['development', billingDevelopmentEnvironment, false],
    ['production', billingProductionEnvironment, true],
  ])('%s billing console environment uses the loadweaver tenant', (_name, environment, production) => {
    expect(environment.application).toEqual({ production, productName: 'Loadweaver' });
    expect(environment.billing.tenantId).toBe('loadweaver');
    expect(environment.billing.urls.restApi).toMatch(/\/api$/);
  });

  it('points the landing page portal link at the Loadweaver billing console in development', () => {
    expect(developmentEnvironment.landing.urls.portal).toBe('http://localhost:4601');
  });
});

describe('Loadweaver console environments', () => {
  it.each([
    ['development', consoleDevelopmentEnvironment, false],
    ['production', consoleProductionEnvironment, true],
  ])('%s environment names every socket namespace the console uses', (_name, environment, production) => {
    expect(environment.application.production).toBe(production);
    expect(environment.cookieConsent.enabled).toBe(false);
    expect(environment.console.urls.restApi).toMatch(/\/api$/);

    const websocket = environment.console.urls.websocket as Record<string, string>;

    for (const namespace of ['plans', 'logs', 'terminals', 'tunnels', 'topology'])
      expect(websocket[namespace]).toMatch(new RegExp(`/socket/${namespace}$`));
  });
});
