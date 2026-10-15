import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, LOCALE_ID, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
import { ForepathOneTeaserComponent } from '../forepath-one-teaser/forepath-one-teaser.component';
import { RentalIllustrationComponent } from '../illustrations/rental-illustration.component';
import { ENVIRONMENT, type EnvironmentWithLandingAndCommunication } from '@forepath/shared/frontend/util-configuration';
import { SharedLogoGridComponent, type SharedLogoGridLogo } from '@forepath/shared/frontend/feature-landingpage';
import { addPageMetaTags, buildPageMetaTags } from '@forepath/shared/frontend/util-meta';
import { FpcButtonComponent } from '@forepath/shared/frontend/ui-components';

const VENDOR_LOGO_SLOTS: readonly (readonly SharedLogoGridLogo[])[] = [
  [
    { id: 'dell', name: 'Dell', logoUrl: 'assets/images/logos/dell.svg', compact: true },
    { id: 'hp', name: 'HP', logoUrl: 'assets/images/logos/hp.svg' },
    { id: 'acer', name: 'Acer', logoUrl: 'assets/images/logos/acer.svg', compact: true },
    { id: 'asus', name: 'Asus', logoUrl: 'assets/images/logos/asus.svg', compact: true },
    { id: 'apc', name: 'APC', logoUrl: 'assets/images/logos/apc.svg' },
  ],
  [
    { id: 'fujitsu', name: 'Fujitsu', logoUrl: 'assets/images/logos/fujitsu.svg' },
    { id: 'lenovo', name: 'Lenovo', logoUrl: 'assets/images/logos/lenovo.png' },
    { id: 'gigabyte', name: 'Gigabyte', logoUrl: 'assets/images/logos/gigabyte.svg' },
    { id: 'hpe', name: 'Hewlett Packard Enterprise', logoUrl: 'assets/images/logos/hpe.svg' },
    { id: 'supermicro', name: 'Supermicro', logoUrl: 'assets/images/logos/supermicro.svg' },
    { id: 'proxmox', name: 'Proxmox', logoUrl: 'assets/images/logos/proxmox.svg' },
  ],
  [
    { id: 'samsung', name: 'Samsung', logoUrl: 'assets/images/logos/samsung.svg' },
    { id: 'kioxia', name: 'Kioxia', logoUrl: 'assets/images/logos/kioxia.svg', compact: true },
    { id: 'ceph', name: 'Ceph', logoUrl: 'assets/images/logos/ceph.png' },
    { id: 'huawei', name: 'Huawei', logoUrl: 'assets/images/logos/huawei.svg' },
    { id: 'cisco', name: 'Cisco', logoUrl: 'assets/images/logos/cisco.svg' },
  ],
  [
    { id: 'arista', name: 'Arista', logoUrl: 'assets/images/logos/arista.svg' },
    { id: 'fortinet', name: 'Fortinet', logoUrl: 'assets/images/logos/fortinet.svg' },
    { id: 'opnsense', name: 'OpnSense', logoUrl: 'assets/images/logos/opnsense.webp' },
    { id: 'microsoft', name: 'Microsoft', logoUrl: 'assets/images/logos/microsoft.svg' },
  ],
  [
    { id: 'placetel', name: 'Placetel', logoUrl: 'assets/images/logos/placetel.svg' },
    { id: 'intel', name: 'Intel', logoUrl: 'assets/images/logos/intel.svg', compact: true },
    { id: 'amd', name: 'AMD', logoUrl: 'assets/images/logos/amd.svg', compact: true },
    { id: 'mailstore', name: 'MailStore', logoUrl: 'assets/images/logos/mailstore.webp' },
  ],
] as const;

@Component({
  selector: 'framework-forepath-it-systems',
  imports: [
    FpcButtonComponent,
    CommonModule,
    RouterModule,
    ForepathOneTeaserComponent,
    SharedLogoGridComponent,
    RentalIllustrationComponent,
  ],
  styleUrls: ['./it-systems.component.scss'],
  templateUrl: './it-systems.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForepathItSystemsComponent implements OnInit {
  protected readonly logoSlots = VENDOR_LOGO_SLOTS;

  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private readonly environment = inject<EnvironmentWithLandingAndCommunication>(ENVIRONMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    const metaTitle = $localize`:@@featureForepathItSystems-metaTitle:Managed IT systems :: ForePath`;
    const metaDescription = $localize`:@@featureForepathItSystems-metaDescription:ForePath Managed IT for network, servers, workplace, security, backup, and monitoring with documented processes and clear SLAs.`;

    this.titleService.setTitle(metaTitle);
    this.destroyRef.onDestroy(
      addPageMetaTags(
        this.metaService,
        buildPageMetaTags({
          description: metaDescription,
          keywords: $localize`:@@featureForepathItSystems-metaKeywords:ForePath Managed IT, network operations, workplace IT, server management, endpoint security, backup`,
          author: 'IPvX UG (haftungsbeschränkt)',
          robots: 'index, follow',
          canonicalUrl: 'https://forepath.io/it-systems',
          socialTitle: metaTitle,
          socialDescription: metaDescription,
          socialImageUrl: this.environment.socialPreview.urls.image,
          localeId: this.locale,
          localizeCanonicalUrl: this.environment.application.production,
        }),
      ),
    );
  }
}
