import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { RouterModule } from '@angular/router';

export type ForepathOneThread = 'consulting' | 'development' | 'it-systems' | 'community';

interface ThreadStop {
  id: ForepathOneThread;
  label: string;
  detail: string;
  route?: string;
}

@Component({
  selector: 'framework-forepath-one-teaser',
  imports: [RouterModule],
  styleUrls: ['./forepath-one-teaser.component.scss'],
  templateUrl: './forepath-one-teaser.component.html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForepathOneTeaserComponent {
  @Input({ required: true }) activeThread!: ForepathOneThread;

  // The four threads as stops on one line, in the order work usually moves through them.
  protected readonly stops: readonly ThreadStop[] = [
    {
      id: 'consulting',
      label: $localize`:@@featureForepathOneTeaser-nodeConsulting:Consulting`,
      detail: $localize`:@@featureForepathOneTeaser-detailConsulting:Architecture, platforms, and strategy`,
      route: '/consulting',
    },
    {
      id: 'development',
      label: $localize`:@@featureForepathOneTeaser-nodeDevelopment:Development`,
      detail: $localize`:@@featureForepathOneTeaser-detailDevelopment:Software your teams can own`,
      route: '/software-development',
    },
    {
      id: 'it-systems',
      label: $localize`:@@featureForepathOneTeaser-nodeIt:IT systems`,
      detail: $localize`:@@featureForepathOneTeaser-detailIt:Infrastructure and day-to-day operations`,
      route: '/it-systems',
    },
    {
      id: 'community',
      label: $localize`:@@featureForepathOneTeaser-nodeCommunity:Community`,
      detail: $localize`:@@featureForepathOneTeaser-detailCommunity:Blog, open source, and Discord`,
    },
  ];
}
