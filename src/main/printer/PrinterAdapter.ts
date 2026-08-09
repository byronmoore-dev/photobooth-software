import type { PrinterInfo, PrintJobResult } from '../../shared/types';
export interface PrinterAdapter {
  listPrinters(): Promise<PrinterInfo[]>;
  print(input: {
    imagePath: string;
    printerName?: string;
    copies: number;
    paperSize: string;
    orientation: 'portrait' | 'landscape';
  }): Promise<PrintJobResult>;
  testPrint(input: {
    imagePath: string;
    printerName?: string;
    paperSize: string;
    orientation: 'portrait' | 'landscape';
  }): Promise<PrintJobResult>;
}
