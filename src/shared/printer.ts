import type { PrinterInfo } from './types';

export interface PrinterSelection {
  printer?: PrinterInfo;
  explicit: boolean;
  missing: boolean;
}

export const resolvePrinterSelection = (printers: PrinterInfo[], configuredName: string): PrinterSelection => {
  if (configuredName) {
    const printer = printers.find((candidate) => candidate.name === configuredName);
    return { printer, explicit: true, missing: !printer };
  }

  const printer = printers.find((candidate) => candidate.isDefault) ?? printers[0];
  return { printer, explicit: false, missing: !printer };
};

export const printerLabel = (printer: PrinterInfo) => printer.displayName?.trim() || printer.name;
