import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SharedAppIllustrationComponent } from '@forepath/shared/frontend/feature-landingpage';
import {
  FpcBadgeComponent,
  FpcLaneHeaderComponent,
  FpcListComponent,
  FpcListItemComponent,
} from '@forepath/shared/frontend/ui-components';

/** Desktop hero scene: the billing console in the desktop window, an invoice list and the selected invoice. */
@Component({
  selector: 'framework-portal-desktop-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SharedAppIllustrationComponent,
    FpcBadgeComponent,
    FpcLaneHeaderComponent,
    FpcListComponent,
    FpcListItemComponent,
  ],
  template: `
    <shared-app-illustration [label]="label()" windowTitle="Decabill Desktop" [width]="960" [height]="640">
      <nav class="sai-rail">
        <span class="sai-rail__brand"><img src="assets/images/icon_light.svg" alt="" /></span>
        <span class="sai-rail__item"><i class="bi bi-grid-1x2"></i></span>
        <span class="sai-rail__item sai-rail__item--active"><i class="bi bi-file-earmark-text"></i></span>
        <span class="sai-rail__item"><i class="bi bi-people"></i></span>
        <span class="sai-rail__item"><i class="bi bi-kanban"></i></span>
        <span class="sai-rail__item mt-auto"><i class="bi bi-gear"></i></span>
      </nav>

      <section class="sai-col desktop-illustration__invoices">
        <fpc-lane-header title="Invoices" flush />
        <fpc-list [flush]="true" class="sai-body">
          @for (invoice of invoices; track invoice.number) {
            <fpc-list-item [active]="invoice.active">
              <span fpcListItemTitle>{{ invoice.number }}</span>
              <span fpcListItemMeta>{{ invoice.customer }}</span>
              <fpc-badge fpcListItemActions [color]="invoice.color" variant="info" size="sm">{{
                invoice.state
              }}</fpc-badge>
            </fpc-list-item>
          }
        </fpc-list>
      </section>

      <section class="sai-col sai-col--grow">
        <!-- Left-aligned content first: the brand character hangs over this column's top-right corner. -->
        <fpc-lane-header title="INV-2026-0142" flush />
        <div class="sai-body d-flex flex-column gap-2 p-3">
          <div class="desktop-illustration__meta">
            <span class="fw-semibold">Northwind Studio GmbH</span>
            <span>Issued 1 Oct, due 15 Oct</span>
          </div>
          <div class="sai-tool sai-motion-enter" style="--sai-delay: 1.5s">
            <i class="bi bi-filetype-xml"></i>E-invoice created (XRechnung)
          </div>
          <div class="sai-tool sai-motion-enter" style="--sai-delay: 3s">
            <i class="bi bi-envelope-check"></i>Sent to billing&#64;northwind.example
          </div>
          <div class="desktop-illustration__lines">
            @for (line of lines; track line.title) {
              <div class="desktop-illustration__line">
                <span>{{ line.title }}</span>
                <span class="fw-semibold">{{ line.amount }}</span>
              </div>
            }
            <div class="desktop-illustration__line desktop-illustration__line--total">
              <span>Total incl. 19% VAT</span>
              <span>€1,240.00</span>
            </div>
          </div>
        </div>
      </section>
    </shared-app-illustration>
  `,
  styles: [
    `
      .desktop-illustration__invoices {
        flex: 0 0 20rem;
        border-right: var(--bs-border-width) solid var(--bs-border-color);
      }

      .desktop-illustration__meta {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        margin-bottom: 0.25rem;
        color: var(--bs-secondary-color);

        .fw-semibold {
          color: var(--bs-body-color);
        }
      }

      .desktop-illustration__lines {
        border: var(--bs-border-width) solid var(--bs-border-color);
        border-radius: var(--bs-border-radius);
      }

      .desktop-illustration__line {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        padding: 0.5rem 0.75rem;

        & + & {
          border-top: var(--bs-border-width) solid var(--bs-border-color);
        }
      }

      .desktop-illustration__line--total {
        font-weight: 600;
        background-color: var(--bs-tertiary-bg);
      }
    `,
  ],
})
export class DesktopIllustrationComponent {
  readonly label = input.required<string>();

  protected readonly invoices = [
    {
      number: 'INV-2026-0142',
      customer: 'Northwind Studio GmbH',
      state: 'Open',
      color: 'primary' as const,
      active: true,
    },
    { number: 'INV-2026-0141', customer: 'Blue Harbor Media', state: 'Paid', color: 'success' as const, active: false },
    { number: 'INV-2026-0139', customer: 'Acme Hosting', state: 'Paid', color: 'success' as const, active: false },
    { number: 'INV-2026-0118', customer: 'Lindqvist & Co.', state: 'Overdue', color: 'danger' as const, active: false },
  ];

  protected readonly lines = [
    { title: 'Managed hosting M, October', amount: '€480.00' },
    { title: 'Website care, 6 hours', amount: '€562.02' },
  ];
}
