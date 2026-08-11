import { describe, expect, it } from 'vitest';
import { printerTestPageSvg } from '../src/main/printer/printerTestPage';
import { printerLabel, resolvePrinterSelection } from '../src/shared/printer';
import type { PrinterInfo } from '../src/shared/types';

const printers: PrinterInfo[] = [
  { name: 'driver-a', displayName: 'Event Printer', isDefault: false },
  { name: 'driver-b', displayName: 'Office Printer', isDefault: true },
];

describe('printer selection', () => {
  it('follows the Windows default when no explicit printer is configured', () => {
    const selection = resolvePrinterSelection(printers, '');
    expect(selection).toMatchObject({ explicit: false, missing: false, printer: { name: 'driver-b' } });
    expect(printerLabel(selection.printer!)).toBe('Office Printer');
  });

  it('reports a configured printer that Windows no longer exposes', () => {
    expect(resolvePrinterSelection(printers, 'removed-printer')).toEqual({
      printer: undefined,
      explicit: true,
      missing: true,
    });
  });
});

describe('printer test page', () => {
  it('creates a landscape 4 by 6 calibration image and escapes device names', () => {
    const svg = printerTestPageSvg({
      printerName: 'Dye & Photo <Printer>',
      layoutName: 'Landscape Feature',
      printSize: '6 × 4 in',
      orientation: 'landscape',
      createdAt: new Date('2026-08-10T20:00:00.000Z'),
    });

    expect(svg).toContain('width="1800" height="1200"');
    expect(svg).toContain('Dye &amp; Photo &lt;Printer&gt;');
    expect(svg).toContain('Printer test');
  });
});
