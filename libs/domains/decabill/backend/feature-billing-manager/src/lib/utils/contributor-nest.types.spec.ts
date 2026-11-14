import { Controller, Module } from '@nestjs/common';

import {
  isAllowedContributorControllerPath,
  registerContributorNestModules,
  resolveContributorKeyFromPackage,
  resolveNestModuleExport,
  sanitizeContributorSourceKey,
  validateContributorNestModule,
} from './contributor-nest.types';

@Controller('subscriptions/:subscriptionId/items/:itemId/container-manager')
class AllowedItemController {}

@Controller('admin/billing/subscriptions/:subscriptionId/items/:itemId/container-manager')
class AllowedAdminItemController {}

@Controller('contributor/addon/acme-ops')
class AllowedStandaloneController {}

@Controller('admin/billing/contributor/addon/acme-ops')
class AllowedAdminStandaloneController {}

@Controller('invoices')
class HijackInvoicesController {}

@Controller('admin/billing')
class HijackAdminBillingController {}

@Controller('/')
class RootController {}

@Controller('admin')
class AdminOnlyController {}

@Module({ controllers: [AllowedItemController, AllowedAdminItemController] })
class ContainerManagerNestModule {}

@Module({ controllers: [AllowedStandaloneController, AllowedAdminStandaloneController] })
class AcmeOpsNestModule {}

@Module({ controllers: [HijackInvoicesController] })
class HijackNestModule {}

@Module({ controllers: [HijackAdminBillingController] })
class HijackAdminBillingNestModule {}

@Module({ controllers: [RootController] })
class RootNestModule {}

@Module({ controllers: [AdminOnlyController] })
class AdminOnlyNestModule {}

@Module({ controllers: [AllowedItemController] })
class OverlapContainerManagerNestModule {}

describe('contributor-nest.types', () => {
  it('accepts item-scoped and standalone contributor prefixes', () => {
    expect(
      isAllowedContributorControllerPath(
        'subscriptions/:subscriptionId/items/:itemId/container-manager',
        'addon',
        'container-manager',
      ),
    ).toBe(true);
    expect(
      isAllowedContributorControllerPath(
        '/admin/billing/subscriptions/:subscriptionId/items/:itemId/container-manager',
        'addon',
        'container-manager',
      ),
    ).toBe(true);
    expect(isAllowedContributorControllerPath('contributor/addon/acme-ops', 'addon', 'acme-ops')).toBe(true);
    expect(
      isAllowedContributorControllerPath('admin/billing/contributor/integrated/stack-a', 'integrated', 'stack-a'),
    ).toBe(true);
  });

  it('rejects root, admin-only, and one-segment hijacks', () => {
    expect(isAllowedContributorControllerPath('/', 'addon', 'container-manager')).toBe(false);
    expect(isAllowedContributorControllerPath('admin', 'addon', 'container-manager')).toBe(false);
    expect(isAllowedContributorControllerPath('admin/billing', 'addon', 'container-manager')).toBe(false);
    expect(isAllowedContributorControllerPath('invoices', 'addon', 'container-manager')).toBe(false);
    expect(
      isAllowedContributorControllerPath(
        'subscriptions/:subscriptionId/items/:itemId/other',
        'addon',
        'container-manager',
      ),
    ).toBe(false);
  });

  it('sanitizes contributor keys', () => {
    expect(sanitizeContributorSourceKey('container-manager')).toBe('container-manager');
    expect(() => sanitizeContributorSourceKey('ContainerManager')).toThrow('Invalid contributor source key');
    expect(() => sanitizeContributorSourceKey('')).toThrow('Invalid contributor source key');
  });

  it('resolves nestModule and contributorKey exports', () => {
    expect(resolveNestModuleExport({})).toBeUndefined();
    expect(resolveNestModuleExport({ nestModule: ContainerManagerNestModule })).toBe(ContainerManagerNestModule);
    expect(() => resolveNestModuleExport({ nestModule: 'nope' })).toThrow('Invalid nestModule export');
    expect(resolveContributorKeyFromPackage({ contributorKey: 'container-manager' })).toBe('container-manager');
    expect(resolveContributorKeyFromPackage({}, 'acme-ops')).toBe('acme-ops');
    expect(resolveContributorKeyFromPackage({})).toBeUndefined();
  });

  it('validates first-party Container Manager controller paths', () => {
    expect(() =>
      validateContributorNestModule({
        source: 'addon',
        sourceKey: 'container-manager',
        nestModule: ContainerManagerNestModule,
      }),
    ).not.toThrow();
  });

  it('rejects disallowed controller paths at register time', () => {
    expect(() =>
      validateContributorNestModule({
        source: 'addon',
        sourceKey: 'acme-ops',
        nestModule: HijackNestModule,
      }),
    ).toThrow('Contributor controller path is not allowed');
    expect(() =>
      validateContributorNestModule({
        source: 'addon',
        sourceKey: 'acme-ops',
        nestModule: RootNestModule,
      }),
    ).toThrow('Contributor controller path is not allowed');
    expect(() =>
      validateContributorNestModule({
        source: 'addon',
        sourceKey: 'acme-ops',
        nestModule: AdminOnlyNestModule,
      }),
    ).toThrow('Contributor controller path is not allowed');
    expect(() =>
      validateContributorNestModule({
        source: 'addon',
        sourceKey: 'acme-ops',
        nestModule: HijackAdminBillingNestModule,
      }),
    ).toThrow('Contributor controller path is not allowed');
  });

  it('rejects duplicate nestModule identities and overlapping paths', () => {
    expect(() =>
      registerContributorNestModules([
        { source: 'addon', sourceKey: 'container-manager', nestModule: ContainerManagerNestModule },
        { source: 'addon', sourceKey: 'container-manager', nestModule: ContainerManagerNestModule },
      ]),
    ).toThrow('Duplicate contributor nestModule registration');

    expect(() =>
      registerContributorNestModules([
        { source: 'addon', sourceKey: 'container-manager', nestModule: ContainerManagerNestModule },
        { source: 'addon', sourceKey: 'other-manager', nestModule: OverlapContainerManagerNestModule },
      ]),
    ).toThrow('Contributor controller path is not allowed');

    expect(() =>
      registerContributorNestModules([
        { source: 'addon', sourceKey: 'container-manager', nestModule: ContainerManagerNestModule },
        { source: 'integrated', sourceKey: 'container-manager', nestModule: ContainerManagerNestModule },
      ]),
    ).toThrow('Duplicate contributor controller path');

    const modules = registerContributorNestModules([
      { source: 'addon', sourceKey: 'container-manager', nestModule: ContainerManagerNestModule },
      { source: 'addon', sourceKey: 'acme-ops', nestModule: AcmeOpsNestModule },
    ]);

    expect(modules).toEqual([ContainerManagerNestModule, AcmeOpsNestModule]);
  });
});
