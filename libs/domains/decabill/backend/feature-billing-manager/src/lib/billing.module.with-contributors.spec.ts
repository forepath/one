import { Module } from '@nestjs/common';

import { AgenstraControllerContributorModule } from './contributors/agenstra-controller/agenstra-controller.contributor.module';
import { AgenstraManagerContributorModule } from './contributors/agenstra-manager/agenstra-manager.contributor.module';
import { CONTAINER_MANAGER_NEST_REGISTRATION } from './contributors/container-manager/container-manager.contributor.module';
import { ContainerManagerContributorModule } from './contributors/container-manager/container-manager.contributor.module';
import { DecabillBillingContributorModule } from './contributors/decabill-billing/decabill-billing.contributor.module';
import { DigitalOceanContributorModule } from './contributors/digital-ocean/digital-ocean.contributor.module';
import { HetznerContributorModule } from './contributors/hetzner/hetzner.contributor.module';
import { LoadweaverUsageContributorModule } from './contributors/loadweaver-usage/loadweaver-usage.contributor.module';
import { resolveContributorNestImports } from './utils/contributor-nest-registration';

@Module({})
class ExtraContributorNestModule {}

describe('resolveContributorNestImports', () => {
  it('includes the first-party provider, Container Manager, and integrated stack modules', () => {
    const modules = resolveContributorNestImports([]);

    expect(modules).toEqual(
      expect.arrayContaining([
        HetznerContributorModule,
        DigitalOceanContributorModule,
        ContainerManagerContributorModule,
        AgenstraControllerContributorModule,
        AgenstraManagerContributorModule,
        DecabillBillingContributorModule,
        LoadweaverUsageContributorModule,
        CONTAINER_MANAGER_NEST_REGISTRATION.nestModule,
      ]),
    );
  });

  it('includes extra contributor nest modules', () => {
    const extra = {
      source: 'addon' as const,
      sourceKey: 'acme-ops',
      nestModule: ExtraContributorNestModule,
    };
    const modules = resolveContributorNestImports([extra]);

    expect(modules).toContain(ExtraContributorNestModule);
    expect(modules).toContain(HetznerContributorModule);
    expect(modules).toContain(DigitalOceanContributorModule);
    expect(modules).toContain(ContainerManagerContributorModule);
    expect(modules).toContain(AgenstraControllerContributorModule);
    expect(modules).toContain(AgenstraManagerContributorModule);
    expect(modules).toContain(DecabillBillingContributorModule);
  });

  it('rejects a duplicate Container Manager nestModule from extras', () => {
    expect(() =>
      resolveContributorNestImports([
        {
          source: 'addon',
          sourceKey: 'container-manager',
          nestModule: ExtraContributorNestModule,
        },
      ]),
    ).toThrow('Duplicate contributor nestModule registration');
  });
});
