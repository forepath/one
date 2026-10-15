import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SharedAppIllustrationComponent } from '@forepath/shared/frontend/feature-landingpage';
import {
  FpcBadgeComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcLaneHeaderComponent,
  FpcListComponent,
  FpcListItemComponent,
} from '@forepath/shared/frontend/ui-components';

/** "Built for how you sell" scene: editing a service plan with pricing, billing rules and meters. */
@Component({
  selector: 'framework-portal-plan-config-illustration',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SharedAppIllustrationComponent,
    FpcBadgeComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcLaneHeaderComponent,
    FpcListComponent,
    FpcListItemComponent,
  ],
  template: `
    <shared-app-illustration
      [label]="label()"
      address="billing.decabill.com/admin/service-plans"
      [width]="1000"
      [height]="600"
    >
      <nav class="sai-rail">
        <span class="sai-rail__brand"><i class="bi bi-receipt"></i></span>
        <span class="sai-rail__item"><i class="bi bi-grid-1x2"></i></span>
        <span class="sai-rail__item sai-rail__item--active"><i class="bi bi-box-seam"></i></span>
        <span class="sai-rail__item"><i class="bi bi-people"></i></span>
        <span class="sai-rail__item mt-auto"><i class="bi bi-gear"></i></span>
      </nav>

      <section class="sai-col plan-config-illustration__plans">
        <fpc-lane-header title="Service plans" flush />
        <fpc-list [flush]="true" class="sai-body">
          @for (plan of plans; track plan.name) {
            <fpc-list-item [active]="plan.active">
              <span fpcListItemTitle>{{ plan.name }}</span>
              <span fpcListItemMeta>{{ plan.price }}</span>
            </fpc-list-item>
          }
        </fpc-list>
      </section>

      <section class="sai-col sai-col--grow">
        <fpc-lane-header flush>
          <span fpcLaneHeaderTitle>Managed hosting M</span>
          <fpc-badge fpcLaneHeaderActions color="success" variant="info" size="sm">Active</fpc-badge>
        </fpc-lane-header>
        <div class="sai-body p-4">
          <div class="row g-3">
            <fpc-form-field class="col-6" label="Name">
              <fpc-form-control value="Managed hosting M" />
            </fpc-form-field>
            <fpc-form-field class="col-6" label="Service type">
              <fpc-form-control value="Cloud server" />
            </fpc-form-field>
            <fpc-form-field class="col-4" label="Base price (net)">
              <fpc-form-control value="49.00" />
            </fpc-form-field>
            <fpc-form-field class="col-4" label="Billing interval">
              <fpc-form-control value="1 month" />
            </fpc-form-field>
            <fpc-form-field class="col-4" label="Tax category">
              <fpc-form-control value="Standard (19%)" />
            </fpc-form-field>
            <div class="col-12 d-flex gap-4">
              <fpc-form-switch label="Bill in advance" [checked]="true" />
              <fpc-form-switch label="Cancel at period end" [checked]="true" />
            </div>
          </div>
          <div class="plan-config-illustration__meters mt-4">
            <fpc-lane-header title="Usage meters" flush />
            @for (meter of meters; track meter.name) {
              <div class="plan-config-illustration__meter">
                <span>{{ meter.name }}</span>
                <span class="text-body-secondary">{{ meter.included }}</span>
                <span class="fw-semibold">{{ meter.price }}</span>
              </div>
            }
          </div>
        </div>
      </section>
    </shared-app-illustration>
  `,
  styles: [
    `
      .plan-config-illustration__plans {
        flex: 0 0 15rem;
      }

      .plan-config-illustration__meters {
        border: var(--bs-border-width) solid var(--bs-border-color);
        border-radius: var(--bs-border-radius);
        overflow: hidden;
      }

      .plan-config-illustration__meter {
        display: grid;
        grid-template-columns: 1fr auto auto;
        gap: 1.5rem;
        padding: 0.625rem 1rem;
        font-size: 0.875rem;

        & + & {
          border-top: var(--bs-border-width) solid var(--bs-border-color);
        }
      }
    `,
  ],
})
export class PlanConfigIllustrationComponent {
  readonly label = input.required<string>();

  protected readonly plans = [
    { name: 'Managed hosting S', price: '€29.00 / month', active: false },
    { name: 'Managed hosting M', price: '€49.00 / month', active: true },
    { name: 'Managed hosting L', price: '€89.00 / month', active: false },
    { name: 'Website care', price: '€390.00 / month', active: false },
  ];

  protected readonly meters = [
    { name: 'Traffic', included: '1 TB included', price: '€1.00 / TB' },
    { name: 'Backup storage', included: '50 GB included', price: '€0.05 / GB' },
    { name: 'Support hours', included: '1 hour included', price: '€95.00 / hour' },
  ];
}
