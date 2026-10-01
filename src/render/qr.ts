/**
 * QR codes as SVG, for print links to interactive 3D models. Uses the `qrcode` package's
 * encoder (MIT) and draws the modules ourselves so the output is a small, deterministic
 * SVG with a quiet zone of 4 modules (the size the QR standard asks for).
 */
import QRCode from 'qrcode';

export function qrSvg(text: string, opts: { moduleSize?: number; dark?: string } = {}): string {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const quiet = 4;
  const m = opts.moduleSize ?? 4;
  const W = (n + 2 * quiet) * m;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) d += `M${(c + quiet) * m},${(r + quiet) * m}h${m}v${m}h-${m}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}" width="${W}" height="${W}" shape-rendering="crispEdges"><rect width="${W}" height="${W}" fill="#FFFFFF"/><path d="${d}" fill="${opts.dark ?? '#000000'}"/></svg>`;
}
