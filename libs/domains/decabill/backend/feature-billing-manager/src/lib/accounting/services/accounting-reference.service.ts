import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { CounterpartyType, JournalLinkType } from '../constants/accounting.constants';

/** Anything the accounting UI references by id: link targets, counterparties, posting issue sources. */
export type AccountingReferenceType = `${JournalLinkType}` | `${CounterpartyType}`;

interface ReferenceSource {
  /** `FROM` clause; the referenced row is aliased `d`. */
  from: string;
  /** Display label: "<document number>" or "<name> (<number>)" — parentheses, as in the console's option labels. */
  label: string;
  /** Column users type to find the row (document number); absent: by id only. */
  number?: string;
  /** Owning tenant; absent: entity-wide rows. */
  tenant?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERSON = (alias: string) =>
  `COALESCE(NULLIF(${alias}.company, ''), NULLIF(TRIM(CONCAT_WS(' ', ${alias}.first_name, ${alias}.last_name)), ''))`;
const INVOICE_OWNER = 'LEFT JOIN users u ON u.id = i.user_id';
/**
 * Where each reference type lives. Labels are what people know the document by (document numbers, customer /
 * supplier numbers); raw ids stay internal.
 */
const SOURCES: Partial<Record<AccountingReferenceType, ReferenceSource>> = {
  invoice: {
    from: 'billing_invoices d LEFT JOIN users u ON u.id = d.user_id',
    label: 'd.invoice_number',
    number: 'd.invoice_number',
    tenant: 'u.tenant_id',
  },
  credit_document: {
    from: `billing_invoice_credit_documents d JOIN billing_invoices i ON i.id = d.invoice_id ${INVOICE_OWNER}`,
    label: 'd.document_number',
    number: 'd.document_number',
    tenant: 'u.tenant_id',
  },
  void_document: {
    from: `billing_invoice_void_documents d JOIN billing_invoices i ON i.id = d.invoice_id ${INVOICE_OWNER}`,
    label: 'd.document_number',
    number: 'd.document_number',
    tenant: 'u.tenant_id',
  },
  supplier_invoice: {
    from: 'billing_supplier_invoices d LEFT JOIN billing_supplier_profiles p ON p.id = d.supplier_id',
    label: `CONCAT(d.invoice_number, ' (' || COALESCE(${PERSON('p')}, p.supplier_number) || ')')`,
    number: 'd.invoice_number',
    tenant: 'p.tenant_id',
  },
  settlement: {
    from: `billing_document_settlements d
      LEFT JOIN billing_invoices i ON d.document_type = 'invoice' AND i.id = d.document_id
      LEFT JOIN billing_supplier_invoices s ON d.document_type = 'supplier_invoice' AND s.id = d.document_id
      ${INVOICE_OWNER}
      LEFT JOIN billing_supplier_profiles p ON p.id = s.supplier_id`,
    label: `CONCAT_WS(' ', INITCAP(REPLACE(d.type, '_', ' ')), COALESCE(i.invoice_number, s.invoice_number))`,
    tenant: 'COALESCE(u.tenant_id, p.tenant_id)',
  },
  payment_attempt: {
    from: `billing_payment_attempts d JOIN billing_invoices i ON i.id = d.invoice_id ${INVOICE_OWNER}`,
    label: `CONCAT(i.invoice_number, ' (' || d.processor || ')')`,
    tenant: 'u.tenant_id',
  },
  payment_refund: {
    from: `billing_payment_refunds d JOIN billing_invoices i ON i.id = d.invoice_id ${INVOICE_OWNER}`,
    label: `CONCAT(i.invoice_number, ' (' || d.processor || ')')`,
    tenant: 'u.tenant_id',
  },
  bank_transaction: {
    from: 'billing_accounting_bank_transactions d',
    // "<counterparty or text> (<date>, <amount>)"
    label: `TRIM(CONCAT(LEFT(COALESCE(NULLIF(d.counterparty_name, ''), NULLIF(d.remittance, ''), d.booking_text), 60),
      ' (' || TO_CHAR(d.booking_date, 'YYYY-MM-DD') || ', ' || d.amount || ' ' || d.currency || ')'))`,
    tenant: 'd.tenant_id',
  },
  inventory_movement: {
    from: 'billing_inventory_movements d',
    label: 'd.document_number',
    number: 'd.document_number',
    tenant: 'd.tenant_id',
  },
  fixed_asset: {
    from: 'billing_accounting_fixed_assets d',
    label: `CONCAT(d.name, ' (' || d.asset_number || ')')`,
    number: 'd.asset_number',
    tenant: 'd.tenant_id',
  },
  offer: {
    from: 'billing_offers d LEFT JOIN users u ON u.id = d.user_id',
    label: 'd.offer_number',
    number: 'd.offer_number',
    tenant: 'u.tenant_id',
  },
  project: {
    from: 'billing_projects d LEFT JOIN users u ON u.id = d.user_id',
    label: 'd.name',
    number: 'd.name',
    tenant: 'u.tenant_id',
  },
  subscription: {
    from: 'billing_subscriptions d LEFT JOIN users u ON u.id = d.user_id',
    label: 'd.number',
    number: 'd.number',
    tenant: 'u.tenant_id',
  },
  stored_file: {
    from: 'billing_stored_files d',
    // Storage keys end in "<uuid>-<hash>-<original name>"; the original name is what people uploaded.
    label: `REGEXP_REPLACE(SPLIT_PART(d.storage_key, '/', -1), '^[0-9a-f-]{36}-[0-9a-f]{12}-', '')`,
    tenant: 'd.tenant_id',
  },
  vat_return: {
    from: 'billing_accounting_vat_returns d',
    label: `CONCAT(d.definition_key, ' ', TO_CHAR(d.period_start, 'YYYY-MM-DD'), ' – ', TO_CHAR(d.period_end, 'YYYY-MM-DD'))`,
  },
  journal_entry: {
    from: 'billing_accounting_journal_entries d',
    label: `CONCAT(d.entry_number::text, ' (' || d.document_number || ')')`,
    number: 'd.entry_number::text',
    tenant: 'd.tenant_id',
  },
  customer: {
    from: 'users d LEFT JOIN billing_customer_profiles c ON c.user_id = d.id',
    label: `CONCAT(COALESCE(${PERSON('c')}, d.email), ' (' || c.customer_number || ')')`,
    number: 'c.customer_number',
    tenant: 'd.tenant_id',
  },
  supplier: {
    from: 'billing_supplier_profiles d',
    label: `COALESCE(${PERSON('d')} || ' (' || d.supplier_number || ')', ${PERSON('d')}, d.supplier_number)`,
    number: 'd.supplier_number',
    tenant: 'd.tenant_id',
  },
};

export interface AccountingReference {
  type: string;
  id: string | null | undefined;
}

/**
 * Turns accounting references (link targets, counterparties, posting issue sources) into the labels people know
 * them by, and resolves what people type (a document / customer / supplier number, or an id) back to the id.
 */
@Injectable()
export class AccountingReferenceService {
  constructor(private readonly dataSource: DataSource) {}

  static key(type: string, id: string): string {
    return `${type}:${id}`;
  }

  /** Whether a type can be entered by its number (else only by id). */
  static acceptsNumber(type: string): boolean {
    return Boolean(SOURCES[type as AccountingReferenceType]?.number);
  }

  /**
   * Labels by `type:id` (see {@link key}); references without a known label are left out. With `tenantId`, only rows
   * of that tenant (or entity-wide rows) are labelled.
   */
  async labels(
    refs: readonly AccountingReference[],
    manager?: EntityManager,
    tenantId: string | null = null,
  ): Promise<Map<string, string>> {
    const runner = manager ?? this.dataSource.manager;
    const byType = new Map<string, Set<string>>();

    for (const ref of refs) {
      if (!ref.id || !UUID.test(ref.id) || !SOURCES[ref.type as AccountingReferenceType]) continue;

      byType.set(ref.type, (byType.get(ref.type) ?? new Set()).add(ref.id));
    }

    const labels = new Map<string, string>();

    for (const [type, ids] of byType) {
      const source = SOURCES[type as AccountingReferenceType]!;
      const tenantFilter = tenantId !== null && source.tenant ? ` AND ${source.tenant} = $2` : '';
      const rows: Array<{ id: string; label: string | null }> = await runner.query(
        `SELECT d.id::text AS id, ${source.label} AS label FROM ${source.from} WHERE d.id = ANY($1::uuid[])${tenantFilter}`,
        tenantFilter ? [[...ids], tenantId] : [[...ids]],
      );

      for (const row of rows) {
        if (row.label?.trim()) labels.set(AccountingReferenceService.key(type, row.id), row.label.trim());
      }
    }

    return labels;
  }

  async label(type: string, id: string, tenantId: string | null = null): Promise<string | null> {
    return (
      (await this.labels([{ type, id }], undefined, tenantId)).get(AccountingReferenceService.key(type, id)) ?? null
    );
  }

  /**
   * Resolves what was typed (a number, or an id) to the referenced id, within `tenantId` when given (numbers can
   * repeat across tenants and suppliers; another tenant's document counts as not found); several matches are
   * rejected as ambiguous.
   */
  async resolve(type: string, input: string, tenantId: string | null, manager?: EntityManager): Promise<string> {
    const source = SOURCES[type as AccountingReferenceType];
    const value = input.trim();

    if (!value) throw new BadRequestException('Enter a document number');

    // Types without a table of their own (processor transactions) are referenced by their external id as typed.
    if (!source) return value;

    const runner = manager ?? this.dataSource.manager;
    // Ids and numbers alike stay within the tenant: a document of another tenant is "not found".
    const tenantFilter = tenantId !== null && source.tenant ? ` AND ${source.tenant} = $2` : '';

    if (UUID.test(value)) {
      const rows: Array<{ id: string }> = await runner.query(
        `SELECT d.id::text AS id FROM ${source.from} WHERE d.id = $1::uuid${tenantFilter}`,
        tenantFilter ? [value, tenantId] : [value],
      );

      if (rows[0]) return rows[0].id;
    }

    if (!source.number) {
      throw new NotFoundException(`${this.typeName(type)} ${value} not found`);
    }

    const rows: Array<{ id: string }> = await runner.query(
      `SELECT d.id::text AS id FROM ${source.from} WHERE UPPER(${source.number}) = UPPER($1)${tenantFilter} LIMIT 2`,
      tenantFilter ? [value, tenantId] : [value],
    );

    if (rows.length === 0) throw new NotFoundException(`${this.typeName(type)} ${value} not found`);

    if (rows.length > 1) {
      throw new BadRequestException(`${this.typeName(type)} ${value} is ambiguous; pick the document from its page`);
    }

    return rows[0].id;
  }

  private typeName(type: string): string {
    const name = type.replace(/_/g, ' ');

    return name.charAt(0).toUpperCase() + name.slice(1);
  }
}
