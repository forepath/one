import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { AccountingAccountRole, AccountingAccountType, TaxCodeKind } from '../constants/accounting.constants';
import { AccountingAccountEntity } from '../entities/accounting-account.entity';
import { AccountingChartEntity } from '../entities/accounting-chart.entity';
import { AccountingJournalLineEntity } from '../entities/accounting-journal-line.entity';
import { AccountingTaxCodeEntity } from '../entities/accounting-tax-code.entity';
import type { ChartTemplate } from '../profiles/accounting-profile.types';
import { CHART_TEMPLATES } from '../profiles/accounting-profiles.registry';

export interface AccountInput {
  number: string;
  name: string;
  type: AccountingAccountType;
  role?: AccountingAccountRole | null;
  statementPosition?: string | null;
  isAutomatic?: boolean;
  defaultTaxCodeId?: string | null;
  isActive?: boolean;
  description?: string | null;
  externalCodes?: Record<string, string> | null;
}

export interface TaxCodeInput {
  code: string;
  name: string;
  kind: TaxCodeKind;
  rate?: number | null;
  accountId?: string | null;
  reverseAccountId?: string | null;
  baseBox?: string | null;
  taxBox?: string | null;
  reverseTaxBox?: string | null;
  ecSalesList?: boolean;
  oss?: boolean;
  datevBuKey?: string | null;
  isActive?: boolean;
}

export interface AccountImportRow {
  number: string;
  name: string;
  type?: AccountingAccountType;
  statementPosition?: string | null;
}

const ACCOUNT_NUMBER_RE = /^[0-9A-Za-z][0-9A-Za-z.-]{0,19}$/;

/** Charts of accounts: creation from country templates or from scratch, account/tax-code maintenance, imports. */
@Injectable()
export class AccountingChartService {
  private readonly roleCache = new Map<string, Map<AccountingAccountRole, AccountingAccountEntity>>();

  constructor(private readonly dataSource: DataSource) {}

  listTemplates(): ChartTemplate[] {
    return Object.values(CHART_TEMPLATES);
  }

  async listCharts(manager?: EntityManager): Promise<AccountingChartEntity[]> {
    return await (manager ?? this.dataSource.manager)
      .getRepository(AccountingChartEntity)
      .find({ order: { createdAt: 'ASC' } });
  }

  async getChart(chartId: string, manager?: EntityManager): Promise<AccountingChartEntity> {
    const chart = await (manager ?? this.dataSource.manager)
      .getRepository(AccountingChartEntity)
      .findOne({ where: { id: chartId } });

    if (!chart) {
      throw new NotFoundException('Chart of accounts not found');
    }

    return chart;
  }

  async findChartByCode(code: string, manager?: EntityManager): Promise<AccountingChartEntity | null> {
    return await (manager ?? this.dataSource.manager).getRepository(AccountingChartEntity).findOne({ where: { code } });
  }

  /** Creates a chart from a template (accounts, tax codes, automatic accounts, VAT account roles). */
  async createFromTemplate(
    templateKey: string,
    options: { code?: string; name?: string } = {},
    manager?: EntityManager,
  ): Promise<AccountingChartEntity> {
    const template = CHART_TEMPLATES[templateKey];

    if (!template) {
      throw new BadRequestException(`Unknown chart template ${templateKey}`);
    }

    const run = async (m: EntityManager): Promise<AccountingChartEntity> => {
      const code = (options.code ?? template.key).trim().toUpperCase();

      if (await this.findChartByCode(code, m)) {
        throw new ConflictException(`Chart ${code} already exists`);
      }

      const chart = await m.getRepository(AccountingChartEntity).save(
        m.getRepository(AccountingChartEntity).create({
          code,
          name: options.name ?? template.name,
          country: template.country,
          templateKey: template.key,
          accountLength: template.accountLength,
        }),
      );
      const taxRepo = m.getRepository(AccountingTaxCodeEntity);
      const taxCodes = new Map<string, AccountingTaxCodeEntity>();

      for (const tc of template.taxCodes) {
        const saved = await taxRepo.save(
          taxRepo.create({
            chartId: chart.id,
            code: tc.code,
            name: tc.name,
            kind: tc.kind,
            rate: tc.rate,
            baseBox: tc.baseBox ?? null,
            taxBox: tc.taxBox ?? null,
            reverseTaxBox: tc.reverseTaxBox ?? null,
            ecSalesList: tc.ecSalesList ?? false,
            oss: tc.oss ?? false,
            datevBuKey: tc.datevBuKey ?? null,
          }),
        );

        taxCodes.set(tc.code, saved);
      }

      const accountRepo = m.getRepository(AccountingAccountEntity);
      const byRole = new Map<AccountingAccountRole, AccountingAccountEntity>();

      for (const account of template.accounts) {
        const saved = await accountRepo.save(
          accountRepo.create({
            chartId: chart.id,
            number: account.number,
            name: account.name,
            type: account.type,
            role: account.role ?? null,
            statementPosition: account.statementPosition ?? null,
            isAutomatic: Boolean(account.automaticTaxCode),
            defaultTaxCodeId: account.automaticTaxCode ? (taxCodes.get(account.automaticTaxCode)?.id ?? null) : null,
            isTemplate: true,
            externalCodes: account.externalCodes ?? null,
          }),
        );

        if (account.role) {
          byRole.set(account.role, saved);
        }
      }

      for (const tc of template.taxCodes) {
        const entity = taxCodes.get(tc.code)!;
        const accountId = tc.accountRole ? (byRole.get(tc.accountRole)?.id ?? null) : null;
        const reverseAccountId = tc.reverseAccountRole ? (byRole.get(tc.reverseAccountRole)?.id ?? null) : null;

        if (accountId || reverseAccountId) {
          await taxRepo.update(entity.id, { accountId, reverseAccountId });
        }
      }

      return chart;
    };

    return manager ? await run(manager) : await this.dataSource.transaction(run);
  }

  /** Empty chart for building accounts from scratch. */
  async createEmpty(input: {
    code: string;
    name: string;
    country?: string | null;
    accountLength?: number;
  }): Promise<AccountingChartEntity> {
    const code = input.code.trim().toUpperCase();

    if (!/^[A-Z0-9-]{2,32}$/.test(code)) {
      throw new BadRequestException('Chart code must be 2–32 characters A–Z, 0–9 or -');
    }

    if (await this.findChartByCode(code)) {
      throw new ConflictException(`Chart ${code} already exists`);
    }

    const repo = this.dataSource.getRepository(AccountingChartEntity);

    return await repo.save(
      repo.create({
        code,
        name: input.name.trim(),
        country: input.country?.toUpperCase() ?? null,
        templateKey: null,
        accountLength: input.accountLength ?? 4,
      }),
    );
  }

  async listAccounts(chartId: string, manager?: EntityManager): Promise<AccountingAccountEntity[]> {
    return await (manager ?? this.dataSource.manager)
      .getRepository(AccountingAccountEntity)
      .find({ where: { chartId }, order: { number: 'ASC' } });
  }

  async listTaxCodes(chartId: string, manager?: EntityManager): Promise<AccountingTaxCodeEntity[]> {
    return await (manager ?? this.dataSource.manager)
      .getRepository(AccountingTaxCodeEntity)
      .find({ where: { chartId }, order: { code: 'ASC' } });
  }

  async getAccount(accountId: string, manager?: EntityManager): Promise<AccountingAccountEntity> {
    const account = await (manager ?? this.dataSource.manager)
      .getRepository(AccountingAccountEntity)
      .findOne({ where: { id: accountId } });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    return account;
  }

  async findAccountByNumber(
    chartId: string,
    number: string,
    manager?: EntityManager,
  ): Promise<AccountingAccountEntity | null> {
    return await (manager ?? this.dataSource.manager)
      .getRepository(AccountingAccountEntity)
      .findOne({ where: { chartId, number } });
  }

  /** Account assigned to a system role (cached per chart; cache is cleared on every account change). */
  async getAccountByRole(
    chartId: string,
    role: AccountingAccountRole,
    manager?: EntityManager,
  ): Promise<AccountingAccountEntity | null> {
    let roles = this.roleCache.get(chartId);

    if (!roles) {
      const accounts = await this.listAccounts(chartId, manager);

      roles = new Map(accounts.filter((a) => a.role).map((a) => [a.role!, a]));
      this.roleCache.set(chartId, roles);
    }

    return roles.get(role) ?? null;
  }

  async requireAccountByRole(
    chartId: string,
    role: AccountingAccountRole,
    manager?: EntityManager,
  ): Promise<AccountingAccountEntity> {
    const account = await this.getAccountByRole(chartId, role, manager);

    if (!account) {
      throw new BadRequestException(`No account is assigned to role "${role}" in the chart of accounts`);
    }

    if (!account.isActive) {
      throw new BadRequestException(`Account ${account.number} (role "${role}") is inactive`);
    }

    return account;
  }

  async findTaxCode(chartId: string, code: string, manager?: EntityManager): Promise<AccountingTaxCodeEntity | null> {
    return await (manager ?? this.dataSource.manager)
      .getRepository(AccountingTaxCodeEntity)
      .findOne({ where: { chartId, code } });
  }

  async createAccount(chartId: string, input: AccountInput): Promise<AccountingAccountEntity> {
    await this.getChart(chartId);
    this.validateAccountInput(input);

    if (await this.findAccountByNumber(chartId, input.number)) {
      throw new ConflictException(`Account ${input.number} already exists`);
    }

    await this.assertRoleFree(chartId, input.role ?? null);

    const repo = this.dataSource.getRepository(AccountingAccountEntity);
    const saved = await repo.save(
      repo.create({
        chartId,
        number: input.number.trim(),
        name: input.name.trim(),
        type: input.type,
        role: input.role ?? null,
        statementPosition: input.statementPosition ?? null,
        isAutomatic: input.isAutomatic ?? false,
        defaultTaxCodeId: input.defaultTaxCodeId ?? null,
        isActive: input.isActive ?? true,
        isTemplate: false,
        description: input.description ?? null,
        externalCodes: input.externalCodes ?? null,
      }),
    );

    this.roleCache.delete(chartId);

    return saved;
  }

  /**
   * Updates an account. Number and type are frozen once the account has bookings (exports and statements of
   * locked periods must stay reproducible); use a new account and deactivate the old one instead.
   */
  async updateAccount(accountId: string, input: Partial<AccountInput>): Promise<AccountingAccountEntity> {
    const account = await this.getAccount(accountId);
    const used = await this.isAccountUsed(accountId);

    if (used && input.number !== undefined && input.number.trim() !== account.number) {
      throw new BadRequestException('The number of an account with bookings cannot be changed');
    }

    if (used && input.type !== undefined && input.type !== account.type) {
      throw new BadRequestException('The type of an account with bookings cannot be changed');
    }

    const merged: AccountInput = {
      number: input.number?.trim() ?? account.number,
      name: input.name?.trim() ?? account.name,
      type: input.type ?? account.type,
      role: input.role !== undefined ? input.role : (account.role ?? null),
      statementPosition: input.statementPosition !== undefined ? input.statementPosition : account.statementPosition,
      isAutomatic: input.isAutomatic ?? account.isAutomatic,
      defaultTaxCodeId: input.defaultTaxCodeId !== undefined ? input.defaultTaxCodeId : account.defaultTaxCodeId,
      isActive: input.isActive ?? account.isActive,
      description: input.description !== undefined ? input.description : account.description,
      externalCodes: input.externalCodes !== undefined ? input.externalCodes : account.externalCodes,
    };

    this.validateAccountInput(merged);

    if (merged.number !== account.number && (await this.findAccountByNumber(account.chartId, merged.number))) {
      throw new ConflictException(`Account ${merged.number} already exists`);
    }

    if (merged.role && merged.role !== account.role) {
      await this.assertRoleFree(account.chartId, merged.role);
    }

    await this.dataSource.getRepository(AccountingAccountEntity).update(accountId, {
      number: merged.number,
      name: merged.name,
      type: merged.type,
      role: merged.role ?? null,
      statementPosition: merged.statementPosition ?? null,
      isAutomatic: merged.isAutomatic ?? false,
      defaultTaxCodeId: merged.defaultTaxCodeId ?? null,
      isActive: merged.isActive ?? true,
      description: merged.description ?? null,
      externalCodes: merged.externalCodes ?? null,
    });
    this.roleCache.delete(account.chartId);

    return await this.getAccount(accountId);
  }

  /** Deletes an unused account; accounts with bookings can only be deactivated. */
  async deleteAccount(accountId: string): Promise<void> {
    const account = await this.getAccount(accountId);

    if (await this.isAccountUsed(accountId)) {
      throw new BadRequestException('Accounts with bookings cannot be deleted; deactivate them instead');
    }

    await this.dataSource.getRepository(AccountingTaxCodeEntity).update({ accountId }, { accountId: null });
    await this.dataSource
      .getRepository(AccountingTaxCodeEntity)
      .update({ reverseAccountId: accountId }, { reverseAccountId: null });
    await this.dataSource.getRepository(AccountingAccountEntity).delete(accountId);
    this.roleCache.delete(account.chartId);
  }

  async createTaxCode(chartId: string, input: TaxCodeInput): Promise<AccountingTaxCodeEntity> {
    await this.getChart(chartId);
    this.validateTaxCodeInput(input);

    if (await this.findTaxCode(chartId, input.code)) {
      throw new ConflictException(`Tax code ${input.code} already exists`);
    }

    await this.assertAccountsInChart(chartId, [input.accountId, input.reverseAccountId]);

    const repo = this.dataSource.getRepository(AccountingTaxCodeEntity);

    return await repo.save(repo.create({ chartId, ...this.normalizeTaxCode(input) }));
  }

  async updateTaxCode(taxCodeId: string, input: Partial<TaxCodeInput>): Promise<AccountingTaxCodeEntity> {
    const repo = this.dataSource.getRepository(AccountingTaxCodeEntity);
    const existing = await repo.findOne({ where: { id: taxCodeId } });

    if (!existing) {
      throw new NotFoundException('Tax code not found');
    }

    const merged: TaxCodeInput = {
      code: input.code ?? existing.code,
      name: input.name ?? existing.name,
      kind: input.kind ?? existing.kind,
      rate: input.rate !== undefined ? input.rate : existing.rate != null ? Number(existing.rate) : null,
      accountId: input.accountId !== undefined ? input.accountId : existing.accountId,
      reverseAccountId: input.reverseAccountId !== undefined ? input.reverseAccountId : existing.reverseAccountId,
      baseBox: input.baseBox !== undefined ? input.baseBox : existing.baseBox,
      taxBox: input.taxBox !== undefined ? input.taxBox : existing.taxBox,
      reverseTaxBox: input.reverseTaxBox !== undefined ? input.reverseTaxBox : existing.reverseTaxBox,
      ecSalesList: input.ecSalesList ?? existing.ecSalesList,
      oss: input.oss ?? existing.oss,
      datevBuKey: input.datevBuKey !== undefined ? input.datevBuKey : existing.datevBuKey,
      isActive: input.isActive ?? existing.isActive,
    };

    this.validateTaxCodeInput(merged);

    if (merged.code !== existing.code && (await this.findTaxCode(existing.chartId, merged.code))) {
      throw new ConflictException(`Tax code ${merged.code} already exists`);
    }

    await this.assertAccountsInChart(existing.chartId, [merged.accountId, merged.reverseAccountId]);
    await repo.update(taxCodeId, this.normalizeTaxCode(merged));

    return (await repo.findOne({ where: { id: taxCodeId } }))!;
  }

  /**
   * Imports accounts (new numbers are created, existing ones get the new name/position; roles are never touched).
   * Accepts parsed CSV rows or a DATEV "Kontenbeschriftungen" (EXTF category 20) file.
   */
  async importAccounts(
    chartId: string,
    rows: AccountImportRow[],
  ): Promise<{ created: number; updated: number; skipped: number }> {
    await this.getChart(chartId);

    if (rows.length > 20_000) {
      throw new BadRequestException('At most 20,000 accounts per import');
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;

    await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(AccountingAccountEntity);

      for (const row of rows) {
        const number = row.number.trim();
        const name = row.name.trim().slice(0, 255);

        if (!ACCOUNT_NUMBER_RE.test(number) || !name) {
          skipped += 1;
          continue;
        }

        const existing = await repo.findOne({ where: { chartId, number } });

        if (existing) {
          await repo.update(existing.id, {
            name,
            ...(row.statementPosition !== undefined ? { statementPosition: row.statementPosition } : {}),
          });
          updated += 1;
        } else {
          await repo.save(
            repo.create({
              chartId,
              number,
              name,
              type: row.type ?? AccountingAccountType.EXPENSE,
              statementPosition: row.statementPosition ?? null,
              isTemplate: false,
            }),
          );
          created += 1;
        }
      }
    });
    this.roleCache.delete(chartId);

    return { created, updated, skipped };
  }

  /** Parses a DATEV Kontenbeschriftungen file (EXTF category 20: Konto; Kontenbeschriftung; Sprach-ID …). */
  parseDatevAccountLabels(text: string): AccountImportRow[] {
    const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);

    if (lines.length < 2 || !/^"?(EXTF|DTVF)"?;/.test(lines[0])) {
      throw new BadRequestException('Not a DATEV EXTF file');
    }

    const header = this.splitDatevLine(lines[0]);

    if (header[2] !== '20') {
      throw new BadRequestException('DATEV file is not a Kontenbeschriftungen export (category 20)');
    }

    return lines.slice(2).map((line) => {
      const cols = this.splitDatevLine(line);

      return { number: cols[0] ?? '', name: cols[1] ?? '' };
    });
  }

  /** Parses `number;name[;type[;statementPosition]]` CSV (header row optional). */
  parseAccountCsv(text: string): AccountImportRow[] {
    const types = new Set<string>(Object.values(AccountingAccountType));
    const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);

    return (
      lines
        // Semicolon CSV (DATEV / German Excel); a row without a semicolon outside quotes is read as comma CSV.
        .map((line) => {
          const cols = this.splitDatevLine(line, ';');

          return cols.length > 1 ? cols : this.splitDatevLine(line, ',');
        })
        // Header rows (e.g. "Kontonummer;Bezeichnung") carry no digit in the number column.
        .filter((cols, index) => /^[0-9A-Za-z]/.test(cols[0] ?? '') && !(index === 0 && !/\d/.test(cols[0])))
        .map((cols) => ({
          number: cols[0],
          name: cols[1] ?? '',
          type: types.has((cols[2] ?? '').toLowerCase())
            ? ((cols[2] ?? '').toLowerCase() as AccountingAccountType)
            : undefined,
          statementPosition: cols[3] ? cols[3] : undefined,
        }))
    );
  }

  async isAccountUsed(accountId: string): Promise<boolean> {
    return (
      (await this.dataSource.getRepository(AccountingJournalLineEntity).count({ where: { accountId }, take: 1 })) > 0
    );
  }

  private splitDatevLine(line: string, delimiter: ';' | ',' = ';'): string[] {
    const out: string[] = [];
    let current = '';
    let quoted = false;

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];

      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else if (ch === '"') {
          quoted = false;
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === delimiter) {
        out.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }

    out.push(current.trim());

    return out;
  }

  private validateAccountInput(input: AccountInput): void {
    if (!ACCOUNT_NUMBER_RE.test(input.number.trim())) {
      throw new BadRequestException('Account number must be 1–20 characters (letters, digits, . or -)');
    }

    if (!input.name.trim()) {
      throw new BadRequestException('Account name is required');
    }

    if (!Object.values(AccountingAccountType).includes(input.type)) {
      throw new BadRequestException('Invalid account type');
    }

    if (input.role && !Object.values(AccountingAccountRole).includes(input.role)) {
      throw new BadRequestException('Invalid account role');
    }
  }

  private validateTaxCodeInput(input: TaxCodeInput): void {
    if (!/^[A-Z0-9_]{2,32}$/.test(input.code)) {
      throw new BadRequestException('Tax code must be 2–32 characters A–Z, 0–9 or _');
    }

    if (!Object.values(TaxCodeKind).includes(input.kind)) {
      throw new BadRequestException('Invalid tax code kind');
    }

    if (input.rate != null && (!Number.isFinite(input.rate) || input.rate < 0 || input.rate > 100)) {
      throw new BadRequestException('Tax rate must be between 0 and 100');
    }

    if (input.datevBuKey && !/^\d{1,4}$/.test(input.datevBuKey)) {
      throw new BadRequestException('DATEV BU key must be 1–4 digits');
    }

    for (const box of [input.baseBox, input.taxBox, input.reverseTaxBox]) {
      if (box && !/^[A-Za-z0-9._-]{1,16}$/.test(box)) {
        throw new BadRequestException('VAT return box ids must be 1–16 characters');
      }
    }
  }

  private normalizeTaxCode(input: TaxCodeInput): Partial<AccountingTaxCodeEntity> {
    return {
      code: input.code,
      name: input.name.trim(),
      kind: input.kind,
      rate: input.rate ?? null,
      accountId: input.accountId ?? null,
      reverseAccountId: input.reverseAccountId ?? null,
      baseBox: input.baseBox ?? null,
      taxBox: input.taxBox ?? null,
      reverseTaxBox: input.reverseTaxBox ?? null,
      ecSalesList: input.ecSalesList ?? false,
      oss: input.oss ?? false,
      datevBuKey: input.datevBuKey ?? null,
      isActive: input.isActive ?? true,
    };
  }

  private async assertRoleFree(chartId: string, role: AccountingAccountRole | null): Promise<void> {
    if (!role) {
      return;
    }

    const holder = await this.dataSource.getRepository(AccountingAccountEntity).findOne({ where: { chartId, role } });

    if (holder) {
      throw new ConflictException(`Role "${role}" is already assigned to account ${holder.number}`);
    }
  }

  private async assertAccountsInChart(chartId: string, accountIds: Array<string | null | undefined>): Promise<void> {
    for (const id of accountIds) {
      if (!id) {
        continue;
      }

      const account = await this.dataSource.getRepository(AccountingAccountEntity).findOne({ where: { id } });

      if (!account || account.chartId !== chartId) {
        throw new BadRequestException('Tax code accounts must belong to the same chart');
      }
    }
  }
}
