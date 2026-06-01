export class CreateFecImportDto {
  fiscalClientId: string;
  periodStart: string; // ISO date string YYYY-MM-DD
  periodEnd: string;
  periodType: "mensuelle" | "trimestrielle";
}
