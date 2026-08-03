import QRCode from 'qrcode';

/**
 * QR codes for the reveal URL printed on rakhi packaging.
 *
 * Nothing is stored. A QR is derived entirely from the URL, so regenerating it
 * on demand is cheaper than keeping a stored copy in sync with the token, and
 * it keeps the whole feature working without object storage (D25).
 */

/**
 * Error correction 'H' recovers from roughly 30% damage.
 *
 * This code is printed on a small tag that gets folded, taped, handled and
 * posted. At 'L' a crease across the card stops it scanning; at 'H' it still
 * reads. The extra density costs nothing at print size.
 */
const ERROR_CORRECTION = 'H' as const;

/** Big enough to print. A 200px code looks fine on screen and prints as mush. */
const DEFAULT_SIZE = 1000;
const MIN_SIZE = 200;
const MAX_SIZE = 3000;

function clampSize(size?: number): number {
  if (!Number.isFinite(size)) return DEFAULT_SIZE;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.trunc(size as number)));
}

export async function generateQrPng(url: string, size?: number): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: 'png',
    errorCorrectionLevel: ERROR_CORRECTION,
    width: clampSize(size),
    margin: 2,
  });
}

/** Vector version — the print partner will ask for it, and it scales cleanly. */
export async function generateQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: ERROR_CORRECTION,
    margin: 2,
  });
}

/**
 * `BR-26-0007-a1b2c3d4.png`.
 *
 * The print partner receives a folder of these and has to match each one to an
 * order; an object id in the filename makes that impossible.
 */
export function qrFilename(
  orderNumber: string | undefined,
  token: string,
  extension: string,
): string {
  const safeOrder = (orderNumber ?? 'bolti').replace(/[^A-Za-z0-9._-]/g, '-');
  return `${safeOrder}-${token}.${extension}`;
}
