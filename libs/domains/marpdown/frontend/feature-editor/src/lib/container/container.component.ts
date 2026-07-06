import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { AuthenticationFacade } from '@forepath/marpdown/frontend/data-access-editor';
import { LocaleService } from '@forepath/shared/frontend/util-configuration';

import { ThemeService } from '../theme.service';

@Component({
  selector: 'marpdown-container',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './container.component.html',
  styleUrls: ['./container.component.scss'],
})
export class MarpdownContainerComponent implements OnInit {
  private readonly authenticationFacade = inject(AuthenticationFacade);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly themeService = inject(ThemeService);
  protected readonly localeService = inject(LocaleService);

  readonly isAuthenticated$ = this.authenticationFacade.isAuthenticated$;
  readonly canAccessUserManager$ = this.authenticationFacade.canAccessUserManager$;

  ngOnInit(): void {
    this.authenticationFacade.checkAuthentication();
  }

  onLogout(): void {
    this.authenticationFacade.logout();
  }
}
