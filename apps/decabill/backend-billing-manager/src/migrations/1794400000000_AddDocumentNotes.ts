import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Optional free-text document notes: invoices and offers carry the note set by the administrator (manual invoice
 * editor, project bill-time dialog, offer editor), void credit notes the note given when voiding. The note is printed
 * on the PDF and embedded as invoice note (EN 16931 BT-22). Existing rows stay null, so documents issued before this
 * migration render exactly as before.
 */
export class AddDocumentNotes1794400000000 implements MigrationInterface {
  name = 'AddDocumentNotes1794400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['billing_invoices', 'billing_offers', 'billing_invoice_void_documents']) {
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "note" text NULL`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['billing_invoice_void_documents', 'billing_offers', 'billing_invoices']) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "note"`);
    }
  }
}
