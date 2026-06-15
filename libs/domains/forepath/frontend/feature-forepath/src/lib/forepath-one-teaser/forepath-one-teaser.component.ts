import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { RouterModule } from '@angular/router';

export type ForepathOneThread = 'consulting' | 'development' | 'it-systems' | 'community';

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
}
