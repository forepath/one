import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  input,
  model,
} from '@angular/core';

export type FpcDropdownAlignment = 'start' | 'end';

export type FpcDropdownDirection = 'down' | 'up';

/**
 * Bootstrap dropdown without the Bootstrap JavaScript bundle. Project the trigger with
 * `[fpcDropdownTrigger]`; everything else becomes the menu content.
 */
@Component({
  selector: 'fpc-dropdown',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'fpc-dropdown',
    '[class.dropdown]': 'direction() === "down"',
    '[class.dropup]': 'direction() === "up"',
  },
  template: `
    <div class="fpc-dropdown__trigger" (click)="toggle()">
      <ng-content select="[fpcDropdownTrigger]" />
    </div>

    @if (open()) {
      <div [class]="menuClasses()" role="menu" (click)="onMenuClick()">
        <ng-content />
      </div>
    }
  `,
  styleUrl: './dropdown.component.scss',
})
export class FpcDropdownComponent {
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  readonly open = model(false);
  readonly alignment = input<FpcDropdownAlignment>('start');
  readonly direction = input<FpcDropdownDirection>('down');
  readonly disabled = input(false);
  /** Keeps the menu open after an item is activated (useful for multi-select filters). */
  readonly closeOnSelect = input(true);

  protected readonly menuClasses = computed(() => {
    const classes = ['dropdown-menu', 'show', 'fpc-dropdown__menu'];

    if (this.alignment() === 'end') {
      classes.push('dropdown-menu-end');
    }

    return classes.join(' ');
  });

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.elementRef.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.open()) {
      this.open.set(false);
    }
  }

  protected toggle(): void {
    if (this.disabled()) {
      return;
    }

    this.open.set(!this.open());
  }

  protected onMenuClick(): void {
    if (this.closeOnSelect()) {
      this.open.set(false);
    }
  }
}
