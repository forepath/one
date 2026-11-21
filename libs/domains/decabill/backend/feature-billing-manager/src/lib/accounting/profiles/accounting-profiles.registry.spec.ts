import { AccountingAccountRole, AccountingAccountType, TaxCodeKind } from '../constants/accounting.constants';
import { AccountingVatReturnService } from '../services/accounting-vat-return.service';

import type {
  AccountingCountryProfile,
  ChartTemplate,
  StatementLayout,
  StatementLayoutLine,
} from './accounting-profile.types';
import {
  ACCOUNTING_PROFILES,
  CHART_TEMPLATES,
  EINVOICE_MANDATE_COUNTRIES,
  listChartTemplates,
  resolveAccountingProfile,
} from './accounting-profiles.registry';

/** Countries outside the EU: OSS roles are not applicable. */
const NON_EU_COUNTRIES = new Set(['CH', 'GB']);
const EU_ONLY_ROLES = new Set<AccountingAccountRole>([
  AccountingAccountRole.REVENUE_OSS,
  AccountingAccountRole.VAT_OUTPUT_OSS,
]);

function leaves(lines: StatementLayoutLine[] | undefined): string[] {
  return (lines ?? []).flatMap((line) => (line.children?.length ? leaves(line.children) : [line.code]));
}

function layoutLeaves(layout: StatementLayout | undefined): Set<string> {
  if (!layout) {
    return new Set();
  }

  return new Set([...leaves(layout.assets), ...leaves(layout.equityAndLiabilities), ...leaves(layout.lines)]);
}

function profileOf(template: ChartTemplate): AccountingCountryProfile {
  const profile = Object.values(ACCOUNTING_PROFILES).find((candidate) => candidate.templates.includes(template.key));

  if (!profile) {
    throw new Error(`No profile lists template ${template.key}`);
  }

  return profile;
}

function requiredRoles(template: ChartTemplate): AccountingAccountRole[] {
  const nonEu = template.country !== null && NON_EU_COUNTRIES.has(template.country);

  return Object.values(AccountingAccountRole).filter((role) => !(nonEu && EU_ONLY_ROLES.has(role)));
}

function formulaRefs(formula: string): string[] {
  return formula.split(/[\s+-]+/).filter((token) => token.length > 0);
}

const templates = listChartTemplates();

describe('accounting profiles registry', () => {
  it('registers every template referenced by a profile and every template under its key', () => {
    for (const profile of Object.values(ACCOUNTING_PROFILES)) {
      expect(profile.templates).toContain(profile.defaultTemplate);

      for (const key of profile.templates) {
        expect(CHART_TEMPLATES[key]).toBeDefined();
        expect(CHART_TEMPLATES[key].key).toBe(key);
      }
    }

    expect(Object.keys(CHART_TEMPLATES).sort()).toEqual(templates.map((template) => template.key).sort());
    expect(Object.keys(CHART_TEMPLATES)).toEqual(expect.arrayContaining(['DE-SKR03', 'DE-SKR04', 'GENERIC-IFRS']));
  });

  it('resolves profiles case-insensitively with a generic fallback', () => {
    expect(resolveAccountingProfile('at').country).toBe('AT');
    expect(resolveAccountingProfile(' de ').country).toBe('DE');
    expect(resolveAccountingProfile('uk').country).toBe('GB');
    expect(resolveAccountingProfile('PL').country).toBe('*');
    expect(resolveAccountingProfile(null).country).toBe('*');
    expect(resolveAccountingProfile(undefined).country).toBe('*');
    expect(resolveAccountingProfile('').country).toBe('*');
  });

  it('lists e-invoicing mandate notices', () => {
    for (const country of ['IT', 'PL', 'HU', 'RO', 'GR', 'PT', 'HR', 'FR', 'BE', 'ES', 'SK']) {
      expect(EINVOICE_MANDATE_COUNTRIES[country]).toEqual(expect.any(String));
    }
  });

  it.each(
    Object.values(ACCOUNTING_PROFILES).flatMap((profile) =>
      profile.vatReturns.map((definition) => [`${profile.country} ${definition.key}`, definition] as const),
    ),
  )('VAT return %s: computed boxes resolve without cycles in any order', (_key, definition) => {
    const evaluator = Object.create(AccountingVatReturnService.prototype) as AccountingVatReturnService;
    const figures: Record<string, number> = Object.fromEntries(
      definition.boxes.filter((b) => b.kind !== 'computed').map((b) => [b.box, 1]),
    );

    expect(() => evaluator.resolveComputedBoxes(definition, figures)).not.toThrow();

    for (const box of definition.boxes.filter((b) => b.kind === 'computed')) {
      expect(Number.isFinite(figures[box.box])).toBe(true);
    }
  });

  it.each(Object.values(ACCOUNTING_PROFILES).map((profile) => [profile.country, profile] as const))(
    'profile %s has consistent VAT return definitions',
    (_country, profile) => {
      const keys = profile.vatReturns.map((definition) => definition.key);

      expect(new Set(keys).size).toBe(keys.length);

      for (const definition of profile.vatReturns) {
        const boxIds = definition.boxes.map((box) => box.box);
        const boxes = new Set(boxIds);

        expect(boxes.size).toBe(boxIds.length);

        if (definition.resultBox) {
          expect(boxes.has(definition.resultBox)).toBe(true);
        }

        for (const box of definition.boxes) {
          if (box.kind === 'computed') {
            expect(box.formula).toEqual(expect.any(String));

            for (const ref of formulaRefs(box.formula ?? '')) {
              if (!boxes.has(ref)) {
                throw new Error(`${definition.key} box ${box.box} references unknown box ${ref}`);
              }
            }
          }
        }
      }
    },
  );

  describe.each(templates.map((template) => [template.key, template] as const))('template %s', (_key, template) => {
    const profile = profileOf(template);
    const statementLeaves = new Set([...layoutLeaves(profile.balanceSheet), ...layoutLeaves(profile.profitAndLoss)]);
    const cashBasisLeaves = layoutLeaves(profile.cashBasis);
    const taxCodes = new Set(template.taxCodes.map((taxCode) => taxCode.code));
    const roles = new Set(template.accounts.flatMap((account) => (account.role ? [account.role] : [])));
    const vatBoxes = new Set(profile.vatReturns.flatMap((definition) => definition.boxes.map((box) => box.box)));

    it('belongs to the profile country', () => {
      expect(template.country ?? '*').toBe(profile.country);
    });

    it('has unique account numbers and tax codes', () => {
      const numbers = template.accounts.map((account) => account.number);
      const codes = template.taxCodes.map((taxCode) => taxCode.code);

      expect(numbers.filter((number, index) => numbers.indexOf(number) !== index)).toEqual([]);
      expect(codes.filter((code, index) => codes.indexOf(code) !== index)).toEqual([]);
    });

    it('assigns every required role exactly once', () => {
      for (const role of requiredRoles(template)) {
        const holders = template.accounts.filter((account) => account.role === role).map((account) => account.number);

        if (holders.length !== 1) {
          throw new Error(`Role ${role} assigned to [${holders.join(', ')}]`);
        }
      }
    });

    it('resolves automatic tax codes and tax code account roles', () => {
      for (const account of template.accounts) {
        if (account.automaticTaxCode && !taxCodes.has(account.automaticTaxCode)) {
          throw new Error(`Account ${account.number} uses unknown tax code ${account.automaticTaxCode}`);
        }
      }

      for (const taxCode of template.taxCodes) {
        if (taxCode.kind === TaxCodeKind.OUTPUT || taxCode.kind === TaxCodeKind.INPUT) {
          expect(taxCode.accountRole).toBeDefined();
        }

        if (taxCode.kind === TaxCodeKind.REVERSE_CHARGE) {
          expect(taxCode.accountRole).toBeDefined();
          expect(taxCode.reverseAccountRole).toBeDefined();
        }

        for (const role of [taxCode.accountRole, taxCode.reverseAccountRole]) {
          if (role && !roles.has(role)) {
            throw new Error(`Tax code ${taxCode.code} references unassigned role ${role}`);
          }
        }
      }
    });

    it('places every account on an existing statement leaf', () => {
      for (const account of template.accounts) {
        if (account.type === AccountingAccountType.STATISTICAL) {
          expect(account.statementPosition).toBe('STAT');
          continue;
        }

        if (!account.statementPosition || !statementLeaves.has(account.statementPosition)) {
          throw new Error(`Account ${account.number} has unknown statement position ${account.statementPosition}`);
        }
      }
    });

    it('uses only cash-basis positions of the profile layout', () => {
      for (const account of template.accounts) {
        const cashBasis = account.externalCodes?.['cashBasis'];

        if (cashBasis && !cashBasisLeaves.has(cashBasis)) {
          throw new Error(`Account ${account.number} has unknown cash-basis position ${cashBasis}`);
        }
      }
    });

    it('maps tax code boxes to boxes of the profile VAT returns', () => {
      for (const taxCode of template.taxCodes) {
        for (const box of [taxCode.baseBox, taxCode.taxBox, taxCode.reverseTaxBox]) {
          if (box !== undefined && !vatBoxes.has(box)) {
            throw new Error(`Tax code ${taxCode.code} references unknown VAT box ${box}`);
          }
        }
      }
    });
  });
});
