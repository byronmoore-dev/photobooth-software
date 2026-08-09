import { BrowserWindow } from 'electron';
import { unlink, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { PrinterInfo, PrintJobResult } from '../../shared/types';
import type { PrinterAdapter } from './PrinterAdapter';

interface PrintInput {
  imagePath: string;
  printerName?: string;
  copies: number;
  paperSize: string;
  orientation: 'portrait' | 'landscape';
}

const pageSizeFor = (paperSize: string) => {
  if (/4\s*[x×]\s*6/i.test(paperSize)) return { width: 101600, height: 152400 };
  if (/5\s*[x×]\s*7/i.test(paperSize)) return { width: 127000, height: 177800 };
  return undefined;
};

export class WindowsPrinterAdapter implements PrinterAdapter {
  constructor(private readonly owner: () => BrowserWindow | null) {}

  async listPrinters(): Promise<PrinterInfo[]> {
    const window = this.owner();
    if (!window) return [];
    return (await window.webContents.getPrintersAsync()).map((printer) => {
      const options = printer.options as Record<string, unknown>;
      return {
        name: printer.name,
        isDefault: String(options.isDefault ?? options['printer-is-default']).toLowerCase() === 'true',
      };
    });
  }

  async print(input: PrintInput): Promise<PrintJobResult> {
    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const htmlPath = `${input.imagePath}.print.html`;
    const imageUrl = pathToFileURL(input.imagePath).toString();
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:0}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fff}img{display:block;width:100%;height:100%;object-fit:contain}</style></head><body><img src="${imageUrl}" alt=""></body></html>`;
    await writeFile(htmlPath, html, 'utf8');

    try {
      await printWindow.loadFile(htmlPath);
      return await new Promise<PrintJobResult>((resolve) => {
        printWindow.webContents.print(
          {
            silent: true,
            deviceName: input.printerName || undefined,
            copies: input.copies,
            printBackground: true,
            landscape: input.orientation === 'landscape',
            pageSize: pageSizeFor(input.paperSize),
            margins: { marginType: 'none' },
          },
          (success, reason) =>
            resolve({
              submitted: success,
              jobId: crypto.randomUUID(),
              message: success ? 'Print job submitted to Windows' : reason || 'Print submission failed',
            }),
        );
      });
    } finally {
      printWindow.destroy();
      await unlink(htmlPath).catch(() => undefined);
    }
  }

  testPrint(input: Omit<PrintInput, 'copies'>) {
    return this.print({ ...input, copies: 1 });
  }
}
