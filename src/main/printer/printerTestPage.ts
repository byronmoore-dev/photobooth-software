const escapeXml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

interface PrinterTestPageInput {
  printerName: string;
  layoutName: string;
  printSize: string;
  orientation: 'portrait' | 'landscape';
  createdAt: Date;
}

export const printerTestPageSvg = (input: PrinterTestPageInput) => {
  const landscape = input.orientation === 'landscape';
  const width = landscape ? 1800 : 1200;
  const height = landscape ? 1200 : 1800;
  const centerX = width / 2;
  const formatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const printerName = escapeXml(input.printerName);
  const layoutName = escapeXml(input.layoutName);
  const details = escapeXml(
    `${input.printSize} · ${landscape ? 'Landscape' : 'Portrait'} · ${formatter.format(input.createdAt)}`,
  );
  const titleY = landscape ? 470 : 720;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#ffffff"/>
    <rect x="28" y="28" width="${width - 56}" height="${height - 56}" rx="36" fill="none" stroke="#0b1f44" stroke-width="8"/>
    <circle cx="${centerX}" cy="${titleY - 180}" r="82" fill="#ff2f92"/>
    <path d="M ${centerX - 38} ${titleY - 180} l 26 28 54 -62" fill="none" stroke="#ffffff" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="${centerX}" y="${titleY}" text-anchor="middle" fill="#0b1f44" font-family="Arial, sans-serif" font-size="42" font-weight="700" letter-spacing="6">CAMERA BOOTH</text>
    <text x="${centerX}" y="${titleY + 92}" text-anchor="middle" fill="#0b1f44" font-family="Arial, sans-serif" font-size="72" font-weight="700">Printer test</text>
    <text x="${centerX}" y="${titleY + 178}" text-anchor="middle" fill="#53657f" font-family="Arial, sans-serif" font-size="34">${printerName}</text>
    <line x1="${centerX - 330}" y1="${titleY + 240}" x2="${centerX + 330}" y2="${titleY + 240}" stroke="#d8e1ef" stroke-width="4"/>
    <text x="${centerX}" y="${titleY + 310}" text-anchor="middle" fill="#0b1f44" font-family="Arial, sans-serif" font-size="31" font-weight="700">${layoutName}</text>
    <text x="${centerX}" y="${titleY + 365}" text-anchor="middle" fill="#53657f" font-family="Arial, sans-serif" font-size="27">${details}</text>
    <g fill="#ff2f92">
      <rect x="28" y="28" width="80" height="16"/><rect x="28" y="28" width="16" height="80"/>
      <rect x="${width - 108}" y="28" width="80" height="16"/><rect x="${width - 44}" y="28" width="16" height="80"/>
      <rect x="28" y="${height - 44}" width="80" height="16"/><rect x="28" y="${height - 108}" width="16" height="80"/>
      <rect x="${width - 108}" y="${height - 44}" width="80" height="16"/><rect x="${width - 44}" y="${height - 108}" width="16" height="80"/>
    </g>
  </svg>`;
};
