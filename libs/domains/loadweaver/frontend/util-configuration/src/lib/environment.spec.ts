import { environment as developmentEnvironment } from './environment.landingpage';
import { environment as productionEnvironment } from './environment.landingpage.production';
import { environment as billingDevelopmentEnvironment } from './environment.billing-console';
import { environment as billingProductionEnvironment } from './environment.billing-console.production';
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
