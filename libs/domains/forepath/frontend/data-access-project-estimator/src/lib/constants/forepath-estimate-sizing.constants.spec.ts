import {
  inferCalibratedServiceIds,
  inferConsultingBillingFloor,
  inferItSystemsBillingFloor,
  inferItSystemsRateTier,
  inferMinimumConsultingTotal,
  inferMinimumItSystemsTotal,
  inferMinimumSoftwareDevelopmentTotal,
  inferSoftwareDevelopmentBillingFloor,
  isConsultingPrompt,
  isItSystemsPrompt,
  isSoftwareProjectPrompt,
} from './forepath-estimate-sizing.constants';

describe('forepath estimate sizing constants', () => {
  it('should detect software projects from general build language', () => {
    expect(isSoftwareProjectPrompt('We need a customer portal with authentication')).toBe(true);
    expect(isSoftwareProjectPrompt('Schedule a workshop next week')).toBe(false);
  });

  it('should detect consulting-only and it-systems-only prompts separately from software builds', () => {
    const consultingPrompt =
      'We need cloud and security consulting with discovery workshops, architecture review, and a prioritized roadmap for ISO 27001 readiness.';
    const itPrompt =
      'We need managed IT for network monitoring, backup operations, and Microsoft 365 administration for about 80 workstations.';

    expect(isConsultingPrompt(consultingPrompt)).toBe(true);
    expect(isSoftwareProjectPrompt(consultingPrompt)).toBe(false);
    expect(isItSystemsPrompt(itPrompt)).toBe(true);
    expect(isSoftwareProjectPrompt(itPrompt)).toBe(false);
  });

  it('should infer small, medium, and mvp tiers from general scope language', () => {
    expect(inferSoftwareDevelopmentBillingFloor('Need a tiny script fix for one endpoint')).toBe(48);
    expect(inferSoftwareDevelopmentBillingFloor('Need an internal tool with a new API integration')).toBe(160);
    expect(inferSoftwareDevelopmentBillingFloor('Build a customer portal MVP with authentication')).toBe(520);
  });

  it('should infer consulting tiers from general engagement language', () => {
    expect(inferConsultingBillingFloor('Need a quick advisory call on our delivery process')).toBe(48);
    expect(inferConsultingBillingFloor('Run a strategy workshop for our platform team')).toBe(160);
    expect(inferConsultingBillingFloor('Need discovery and a roadmap for our cloud migration')).toBe(520);
    expect(
      inferConsultingBillingFloor(
        'Need cloud and security consulting with discovery workshops, architecture review, and a prioritized roadmap for ISO 27001 readiness.',
      ),
    ).toBe(1600);
  });

  it('should infer it-systems tiers from general operational language', () => {
    expect(inferItSystemsBillingFloor('Need a quick patch applied to one server')).toBe(48);
    expect(inferItSystemsBillingFloor('Need help with workstation provisioning for new hires')).toBe(160);
    expect(inferItSystemsBillingFloor('Need managed IT for network monitoring and backup operations each month')).toBe(
      520,
    );
    expect(
      inferItSystemsBillingFloor(
        'Need managed IT for network monitoring, backup operations, and Microsoft 365 administration for about 80 workstations.',
      ),
    ).toBe(1600);
  });

  it('should infer emergency rate tiers for urgent it-systems requests', () => {
    expect(inferItSystemsRateTier('Need urgent weekend firewall support')).toBe('emergency-week');
    expect(inferItSystemsRateTier('Need emergency support this Sunday')).toBe('emergency-sunday');
  });

  it('should infer complex tiers from general complexity and platform signals', () => {
    const multiPlatformPrompt =
      'Build a complex platform with a web portal, iOS app, and Android app for administrators and public users with live search workflows.';

    expect(inferSoftwareDevelopmentBillingFloor(multiPlatformPrompt)).toBe(1600);
    expect(inferMinimumSoftwareDevelopmentTotal(multiPlatformPrompt)).toBe(1600);
  });

  it('should still classify domain-specific prompts via general signals rather than niche keywords', () => {
    const missingPersonsPrompt =
      'I want to build a somewhat complex software. The public should be able to support police and emts when searching for missing people. Therefore a map like what3words build on top of openstreetmap with an overlay should allow to mark quadrants if searched by a person. Double quadrant checks can be required. I need the public facing app with an interface and an interface for administrators as well as people who create searches. This app should be available as Webapp, iOS app and Android app. It must comply with German law!';

    expect(inferSoftwareDevelopmentBillingFloor(missingPersonsPrompt)).toBe(1600);
    expect(inferMinimumSoftwareDevelopmentTotal(missingPersonsPrompt)).toBe(1600);
    expect(inferCalibratedServiceIds(missingPersonsPrompt)).toEqual(['software-development']);
  });

  it('should default unknown software prompts to the mvp tier minimum', () => {
    expect(inferMinimumSoftwareDevelopmentTotal('We need custom software for our team')).toBe(520);
  });

  it('should expose minimum totals for consulting and it-systems prompts', () => {
    expect(inferMinimumConsultingTotal('Need discovery and a roadmap for our cloud migration')).toBe(520);
    expect(inferMinimumItSystemsTotal('Need help with workstation provisioning for new hires')).toBe(160);
  });
});
