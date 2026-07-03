export enum ReportType {
  TICKET = 'TICKET',
  LEDGER = 'LEDGER',
  STATEMENT = 'STATEMENT',
  UNKNOWN = 'UNKNOWN',
}

export interface VendorProfile {

  id: string;

  name: string;

  reportType: ReportType;

  defaultCurrency?: string;

  aliases: string[];

  requiredColumns: string[];

  optionalColumns: string[];

}