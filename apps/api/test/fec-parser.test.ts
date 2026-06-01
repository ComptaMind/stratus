import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as iconv from "iconv-lite";
import { FECParserService, FECParseError } from "../src/fec/fec-parser.service";

const FIXTURE_PATH = path.join(__dirname, "fixtures/fec_sample_fr.txt");
const PERIOD_START = new Date("2026-01-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-01-31T00:00:00.000Z");

function fixtureBuffer(): Buffer {
  return fs.readFileSync(FIXTURE_PATH);
}

function makeBuffer(content: string, encoding: "utf8" | "latin1" = "utf8"): Buffer {
  if (encoding === "latin1") return iconv.encode(content, "iso-8859-15");
  return Buffer.from(content, "utf-8");
}

// Build a minimal balanced 3-line FEC (pipe separator, comma decimals)
function minimalFEC(overrides?: { separator?: string; decimal?: string }): string {
  const sep = overrides?.separator ?? "|";
  const d = overrides?.decimal ?? ",";
  const header = [
    "JournalCode", "JournalLib", "EcritureNum", "EcritureDate",
    "CompteNum", "CompteLib", "CompAuxNum", "CompAuxLib",
    "PieceRef", "PieceDate", "EcritureLib", "Debit", "Credit",
    "EcritureLet", "DateLet", "ValidDate", "Montantdevise", "Idevise",
  ].join(sep);

  const row = (compteNum: string, debit: string, credit: string) =>
    [
      "AC", "Achats", "1", "20260115",
      compteNum, "Lib", "", "",
      "F01", "20260101", "Lib", debit, credit,
      "", "", "", `0${d}00`, "EUR",
    ].join(sep);

  // 401 credit 100, 606 debit 100 → balanced
  return [header, row("401000", `0${d}00`, `100${d}00`), row("606100", `100${d}00`, `0${d}00`)].join("\n");
}

describe("FECParserService", () => {
  let service: FECParserService;

  beforeEach(() => {
    service = new FECParserService();
  });

  // ── Fixture parsing ─────────────────────────────────────────────────────────

  it("parses the sample fixture: 50 rows, balanced, pipe separator", () => {
    const result = service.parse(fixtureBuffer(), PERIOD_START, PERIOD_END);

    expect(result.rows).toHaveLength(50);
    expect(result.balanceOk).toBe(true);
    expect(result.separator).toBe("|");
    expect(result.totalDebit).toBeCloseTo(24600, 2);
    expect(result.totalCredit).toBeCloseTo(24600, 2);
    expect(result.encoding).toBe("UTF-8");
    expect(result.parserVersion).toBe("1.0.0");
  });

  it("maps all 18 FEC columns correctly on the first row", () => {
    const result = service.parse(fixtureBuffer(), PERIOD_START, PERIOD_END);
    const first = result.rows[0];

    expect(first.journalCode).toBe("AC");
    expect(first.journalLib).toBe("Achats");
    expect(first.ecritureNum).toBe("1");
    expect(first.ecritureDate).toEqual(new Date("2026-01-02T00:00:00.000Z"));
    expect(first.compteNum).toBe("401000");
    expect(first.compteLib).toBe("Fournisseurs généraux");
    expect(first.compAuxNum).toBe("FOUR001");
    expect(first.ecritureLib).toBe("Facture fournitures");
    expect(first.debit).toBe("0.00");
    expect(first.credit).toBe("1200.00");
  });

  // ── Separator detection ─────────────────────────────────────────────────────

  it("parses pipe-separated FEC", () => {
    const buf = makeBuffer(minimalFEC({ separator: "|" }));
    const result = service.parse(buf, PERIOD_START, PERIOD_END);
    expect(result.separator).toBe("|");
    expect(result.rows).toHaveLength(2);
  });

  it("parses tab-separated FEC", () => {
    const buf = makeBuffer(minimalFEC({ separator: "\t" }));
    const result = service.parse(buf, PERIOD_START, PERIOD_END);
    expect(result.separator).toBe("\t");
    expect(result.rows).toHaveLength(2);
  });

  // ── Decimal normalisation ───────────────────────────────────────────────────

  it("normalises comma decimals to dot", () => {
    const buf = makeBuffer(minimalFEC({ decimal: "," }));
    const result = service.parse(buf, PERIOD_START, PERIOD_END);
    expect(result.rows[0].credit).toBe("100.00");
    expect(result.rows[1].debit).toBe("100.00");
  });

  it("accepts dot decimals", () => {
    const buf = makeBuffer(minimalFEC({ decimal: "." }));
    const result = service.parse(buf, PERIOD_START, PERIOD_END);
    expect(result.rows[0].credit).toBe("100.00");
  });

  // ── Encoding ───────────────────────────────────────────────────────────────

  it("decodes UTF-8 encoded FEC", () => {
    const result = service.parse(fixtureBuffer(), PERIOD_START, PERIOD_END);
    expect(result.encoding).toBe("UTF-8");
  });

  it("decodes ISO-8859-15 encoded FEC (accented chars)", () => {
    const content = minimalFEC();
    // Replace CompteLib field specifically (column 6, delimited by |401000|...|)
    const withAccents = content.replace("|401000|Lib|", "|401000|Fournitures généralés|");
    const buf = makeBuffer(withAccents, "latin1");
    const result = service.parse(buf, PERIOD_START, PERIOD_END);
    expect(result.encoding).toBe("ISO-8859-15");
    expect(result.rows[0].compteLib).toContain("généralés");
  });

  // ── Rejection: unbalanced FEC ───────────────────────────────────────────────

  it("rejects FEC where total debit ≠ total credit", () => {
    const sep = "|";
    const d = ",";
    const header = [
      "JournalCode","JournalLib","EcritureNum","EcritureDate",
      "CompteNum","CompteLib","CompAuxNum","CompAuxLib",
      "PieceRef","PieceDate","EcritureLib","Debit","Credit",
      "EcritureLet","DateLet","ValidDate","Montantdevise","Idevise",
    ].join(sep);
    const row = (compte: string, debit: string, credit: string) =>
      ["AC","Achats","1","20260115",compte,"Lib","","","F1","20260101","Lib",debit,credit,"","","",`0${d}00`,"EUR"].join(sep);

    // 401 credit 100, 606 debit 50 → UNBALANCED (debit 50 ≠ credit 100)
    const fec = [header, row("401000", `0${d}00`, `100${d}00`), row("606100", `50${d}00`, `0${d}00`)].join("\n");

    expect(() =>
      service.parse(makeBuffer(fec), PERIOD_START, PERIOD_END)
    ).toThrowError(/balance check failed/i);
  });

  // ── Rejection: wrong column count ──────────────────────────────────────────

  it("rejects rows with wrong column count", () => {
    const fec = [
      "JournalCode|JournalLib|EcritureNum|EcritureDate|CompteNum",
      "AC|Achats|1|20260115|401000",
    ].join("\n");

    expect(() =>
      service.parse(makeBuffer(fec), PERIOD_START, PERIOD_END)
    ).toThrowError(/expected 18 columns/i);
  });

  // ── Rejection: invalid date format ─────────────────────────────────────────

  it("rejects rows with invalid EcritureDate format", () => {
    const content = minimalFEC().replace(
      "20260115", // EcritureDate in first data row
      "2026-01-15" // ISO format instead of YYYYMMDD
    );
    expect(() =>
      service.parse(makeBuffer(content), PERIOD_START, PERIOD_END)
    ).toThrowError(/EcritureDate/i);
  });

  // ── Rejection: CompteNum outside 1-7 ───────────────────────────────────────

  it("rejects CompteNum not starting with 1-7", () => {
    const content = minimalFEC().replace(
      "|401000|",
      "|801000|" // starts with 8 → invalid
    );
    expect(() =>
      service.parse(makeBuffer(content), PERIOD_START, PERIOD_END)
    ).toThrowError(/CompteNum/i);
  });

  // ── Rejection: date outside period ─────────────────────────────────────────

  it("rejects EcritureDate outside the declared period", () => {
    const content = minimalFEC().replace("20260115", "20260215"); // February
    expect(() =>
      service.parse(makeBuffer(content), PERIOD_START, PERIOD_END)
    ).toThrowError(/outside period/i);
  });

  // ── FECParseError carries line number ──────────────────────────────────────

  it("FECParseError includes the line number", () => {
    const content = minimalFEC().replace("20260115", "20260215");
    try {
      service.parse(makeBuffer(content), PERIOD_START, PERIOD_END);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(FECParseError);
      expect((err as FECParseError).line).toBeDefined();
    }
  });
});
