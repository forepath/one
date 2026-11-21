import { Injectable } from '@nestjs/common';

import {
  BANK_STATEMENT_FORMATS,
  BankStatementParseError,
  type BankStatementFormat,
  type CsvColumnMapping,
  type ParsedStatementFile,
} from './bank-import.types';
import { decodeText, type TextEncoding } from './bank-parse.utils';
import { parseBai2 } from './parsers/bai2.parser';
import { parseCamt } from './parsers/camt.parser';
import { parseCbiRh } from './parsers/cbi-rh.parser';
import { parseCfonb120 } from './parsers/cfonb120.parser';
import { parseCoda } from './parsers/coda.parser';
import { parseCsv } from './parsers/csv.parser';
import { detectBankFormat } from './parsers/format-detect';
import { parseMt940 } from './parsers/mt940.parser';
import { parseNorma43 } from './parsers/norma43.parser';
import { parseOfx } from './parsers/ofx.parser';
import { parseQif } from './parsers/qif.parser';
import { isZip, readZipEntries } from './parsers/safe-zip';

export interface ParseRequest {
  buffer: Buffer;
  fileName: string;
  /** Forced format; detected when omitted. */
  format?: BankStatementFormat;
  encoding?: 'auto' | TextEncoding;
  csvMapping?: CsvColumnMapping;
  qifDateFormat?: 'DMY' | 'MDY' | 'auto';
  defaultCurrency?: string;
}

export interface ParsedUpload {
  files: Array<{ name: string; parsed: ParsedStatementFile }>;
  warnings: string[];
}

/** Dispatches uploads (single files or ZIP containers of statements) to the format parsers. */
@Injectable()
export class BankStatementParserService {
  parse(request: ParseRequest): ParsedUpload {
    const warnings: string[] = [];
    const sources: Array<{ name: string; data: Buffer }> = isZip(request.buffer)
      ? readZipEntries(request.buffer).filter((e) => !/\.zip$/i.test(e.name))
      : [{ name: request.fileName, data: request.buffer }];

    if (sources.length === 0) {
      throw new BankStatementParseError('The archive contains no statement files');
    }

    const files: ParsedUpload['files'] = [];

    for (const source of sources) {
      const { text, encoding } = decodeText(source.data, request.encoding ?? 'auto');
      const format = request.format ?? detectBankFormat(text, source.name);

      if (!format || !BANK_STATEMENT_FORMATS.includes(format)) {
        if (sources.length > 1) {
          warnings.push(`${source.name}: unknown format, skipped`);
          continue;
        }

        throw new BankStatementParseError('Unknown statement format; choose the format (or a CSV mapping) explicitly');
      }

      const parsed = this.parseText(format, text, request);

      parsed.encoding = parsed.encoding ?? encoding;
      files.push({ name: source.name, parsed });
    }

    return { files, warnings };
  }

  private parseText(format: BankStatementFormat, text: string, request: ParseRequest): ParsedStatementFile {
    switch (format) {
      case 'camt.052':
      case 'camt.053':
      case 'camt.054':
        return parseCamt(text);
      case 'mt940':
      case 'mt942':
        return parseMt940(text, { format });
      case 'coda':
        return parseCoda(text);
      case 'norma43':
        return parseNorma43(text);
      case 'cfonb120':
        return parseCfonb120(text);
      case 'cbi-rh':
        return parseCbiRh(text);
      case 'bai2':
        return parseBai2(text);
      case 'ofx':
        return parseOfx(text);
      case 'qif':
        return parseQif(text, { dateFormat: request.qifDateFormat ?? 'auto', currency: request.defaultCurrency });
      case 'csv':
        if (!request.csvMapping) {
          throw new BankStatementParseError('CSV files need a column mapping (preset or saved mapping)');
        }

        return parseCsv(text, {
          ...request.csvMapping,
          defaultCurrency: request.csvMapping.defaultCurrency ?? request.defaultCurrency,
        });
      default:
        throw new BankStatementParseError(`Unsupported format ${format as string}`);
    }
  }
}
