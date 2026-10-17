import { Directive, HostListener, input } from '@angular/core';
import { storeContactMessagePrefill } from '@forepath/shared/frontend/feature-landingpage';

/** Default message the contact form opens with after an early access call to action. */
export const LOADWEAVER_EARLY_ACCESS_MESSAGE = $localize`:@@featureLoadweaverPortal-earlyAccessPrefill:Hi, I would like early access to Loadweaver. My setup: number of servers, sites and the workloads I want to run.`;

/** Prefill for Loadweaver Cloud requests (home, cloud and pricing pages). */
export const LOADWEAVER_CLOUD_EARLY_ACCESS_MESSAGE = $localize`:@@featureLoadweaverPortal-cloudEarlyAccessPrefill:Hi, I am interested in Loadweaver Cloud. Please tell me more about early access for a dedicated cluster.`;

/**
 * Put on an early access call to action that links to `/contact`: prefills the contact form message
 * (one-shot, sessionStorage) so the visitor only has to describe their setup.
 */
@Directive({
  selector: '[loadweaverEarlyAccess]',
  standalone: true,
})
export class LoadweaverEarlyAccessDirective {
  /** Overrides the default prefill (e.g. Cloud or Enterprise requests). */
  readonly loadweaverEarlyAccess = input<string>('');

  @HostListener('click')
  onClick(): void {
    storeContactMessagePrefill(this.loadweaverEarlyAccess() || LOADWEAVER_EARLY_ACCESS_MESSAGE);
  }
}
