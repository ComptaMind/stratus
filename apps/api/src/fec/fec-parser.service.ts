import { Injectable } from "@nestjs/common";
import * as iconv from "iconv-lite";

export interface FECRow {
  journalCode: string;
  journalLib: string;
  ecritureNum: string;
  ecritureDate: Date;
  compteNum: string;
  compteLib: string;
  compAuxNum: string | null;
  compAuxLib: string | null;
  pieceRef: string | null;
  pieceDate: Date | null;
  ecritureLib: string;
  debit: string; // normalized decimal string (dot separator)
  credit: string;
  lettrage: string | null;
  dateLet: Date | null;
  validDate: Date | null;
  montantDevise: string | null;
  codeDevise: string | null;
}

export interface ParseResult {
  rows: FECRow[];
  totalDebit: number;
  totalCredit: number;
  balanceOk: boolean;
  separator: "|" | "\t";
  encoding: string;
  parserVersion: string;
}

export class FECParseError extends Error {
  constructor(
    message: string,
    public readonly line?: number
  ) {
    super(message);
    this.name = "FECParseError";
  }
}

const PARSER_VERSION = "1.0.0";
const FEC_COLUMN_COUNT = 18;

@Injectable()
export class FECParserService {
  /**
   * Parse a FEC buffer. Returns ParseResult or throws FECParseError.
   * Validates:
   *  - 18 columns per row
   *  - Total debit == total credit (balance)
   *  - All EcritureDate within [periodStart, periodEnd]
   *  - CompteNum starts with digit 1-7
   *  - Decimals are comma or dot separated → normalised to dot
   */
  parse(buffer: Buffer, periodStart: Date, periodEnd: Date): ParseResult {
    const { text, encoding } = this.decodeBuffer(buffer);
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");

    if (lines.length === 0) {
      throw new FECParseError("Empty file");
    }

    const separator = this.detectSeparator(lines[0]);

    // Skip header row if it looks like column names
    const firstCols = lines[0].split(separator);
    const hasHeader =
      firstCols.length >= 4 &&
      /journal/i.test(firstCols[0]) &&
      !/^\d/.test(firstCols[3]);
    const dataLines = hasHeader ? lines.slice(1) : lines;

    if (dataLines.length === 0) {
      throw new FECParseError("No data rows found");
    }

    const rows: FECRow[] = [];
    let totalDebit = 0;
    let totalCredit = 0;

    for (let i = 0; i < dataLines.length; i++) {
      const lineNum = hasHeader ? i + 2 : i + 1;
      const line = dataLines[i];
      if (!line.trim()) continue;

      const cols = line.split(separator);
      if (cols.length !== FEC_COLUMN_COUNT) {
        throw new FECParseError(
          `Line ${lineNum}: expected ${FEC_COLUMN_COUNT} columns, got ${cols.length}`,
          lineNum
        );
      }

      const row = this.parseRow(cols, lineNum, periodStart, periodEnd);
      totalDebit += parseFloat(row.debit);
      totalCredit += parseFloat(row.credit);
      rows.push(row);
    }

    const debitRounded = Math.round(totalDebit * 100) / 100;
    const creditRounded = Math.round(totalCredit * 100) / 100;
    const balanceOk = Math.abs(debitRounded - creditRounded) < 0.01;

    if (!balanceOk) {
      throw new FECParseError(
        `Balance check failed: total debit=${debitRounded} ≠ total credit=${creditRounded}`
      );
    }

    return {
      rows,
      totalDebit: debitRounded,
      totalCredit: creditRounded,
      balanceOk: true,
      separator,
      encoding,
      parserVersion: PARSER_VERSION,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private parseRow(
    cols: string[],
    lineNum: number,
    periodStart: Date,
    periodEnd: Date
  ): FECRow {
    const c = cols.map((s) => s.trim());
    const [
      journalCode,
      journalLib,
      ecritureNum,
      ecritureDateStr,
      compteNum,
      compteLib,
      compAuxNumRaw,
      compAuxLibRaw,
      pieceRefRaw,
      pieceDateStr,
      ecritureLib,
      debitStr,
      creditStr,
      ecritureLetRaw,
      dateLetStr,
      validDateStr,
      montantDeviseStr,
      idevise,
    ] = c;

    // CompteNum must start with 1-7
    if (!/^[1-7]/.test(compteNum)) {
      throw new FECParseError(
        `Line ${lineNum}: CompteNum "${compteNum}" must start with digit 1–7`,
        lineNum
      );
    }

    const ecritureDate = this.parseFECDate(
      ecritureDateStr,
      lineNum,
      "EcritureDate"
    );

    // Date within period
    if (ecritureDate < periodStart || ecritureDate > periodEnd) {
      throw new FECParseError(
        `Line ${lineNum}: EcritureDate ${ecritureDateStr} is outside period ` +
          `${this.fmt(periodStart)}..${this.fmt(periodEnd)}`,
        lineNum
      );
    }

    const debit = this.normalizeDecimal(debitStr, lineNum, "Debit");
    const credit = this.normalizeDecimal(creditStr, lineNum, "Credit");

    return {
      journalCode,
      journalLib,
      ecritureNum,
      ecritureDate,
      compteNum,
      compteLib,
      compAuxNum: compAuxNumRaw || null,
      compAuxLib: compAuxLibRaw || null,
      pieceRef: pieceRefRaw || null,
      pieceDate: pieceDateStr
        ? this.parseFECDate(pieceDateStr, lineNum, "PieceDate")
        : null,
      ecritureLib,
      debit,
      credit,
      lettrage: ecritureLetRaw || null,
      dateLet: dateLetStr
        ? this.parseFECDate(dateLetStr, lineNum, "DateLet")
        : null,
      validDate: validDateStr
        ? this.parseFECDate(validDateStr, lineNum, "ValidDate")
        : null,
      montantDevise:
        montantDeviseStr && montantDeviseStr !== "0,00" && montantDeviseStr !== "0.00"
          ? this.normalizeDecimal(montantDeviseStr, lineNum, "Montantdevise")
          : null,
      codeDevise: idevise || null,
    };
  }

  private parseFECDate(s: string, lineNum: number, field: string): Date {
    if (!s || !/^\d{8}$/.test(s)) {
      throw new FECParseError(
        `Line ${lineNum}: ${field} "${s}" is not a valid YYYYMMDD date`,
        lineNum
      );
    }
    const year = parseInt(s.slice(0, 4), 10);
    const month = parseInt(s.slice(4, 6), 10) - 1;
    const day = parseInt(s.slice(6, 8), 10);
    const d = new Date(Date.UTC(year, month, day));
    if (isNaN(d.getTime())) {
      throw new FECParseError(
        `Line ${lineNum}: ${field} "${s}" is not a valid calendar date`,
        lineNum
      );
    }
    return d;
  }

  private normalizeDecimal(s: string, lineNum: number, field: string): string {
    // Remove thousands separators (space or non-breaking space), replace comma with dot
    const normalized = s
      .replace(/[\s\u00A0]/g, "")
      .replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
      throw new FECParseError(
        `Line ${lineNum}: ${field} "${s}" is not a valid decimal`,
        lineNum
      );
    }
    return normalized;
  }

  private detectSeparator(line: string): "|" | "\t" {
    const pipes = (line.match(/\|/g) ?? []).length;
    const tabs = (line.match(/\t/g) ?? []).length;
    return pipes >= tabs ? "|" : "\t";
  }

  /**
   * Try UTF-8 first; if replacement chars appear, decode as ISO-8859-15.
   */
  private decodeBuffer(buffer: Buffer): { text: string; encoding: string } {
    const utf8 = buffer.toString("utf-8");
    if (!utf8.includes("\uFFFD")) {
      return { text: utf8, encoding: "UTF-8" };
    }
    const text = iconv.decode(buffer, "iso-8859-15");
    return { text, encoding: "ISO-8859-15" };
  }

  private fmt(d: Date): string {
    return d.toISOString().slice(0, 10);
  }
}
