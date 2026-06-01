export class CreateFiscalClientDto {
  name: string;
  siren?: string;
  vatNumber?: string;
  /** 'réel normal' | 'réel simplifié' | 'franchise' */
  vatRegime: string;
  country?: string;
  /** MM-DD, default 01-01 */
  fiscalYearStart?: string;
}
