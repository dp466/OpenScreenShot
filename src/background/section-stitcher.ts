import type { TileSpec } from '../shared/types';

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MAX_SOURCE_PIXELS = 64_000_000;
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;

/** Decode only a bounded local PNG. Never resolves a URL or makes a request. */
function localPngBlob(dataUrl: string): Blob {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) throw new Error('Capture tiles must be local PNG images.');
  const encoded = dataUrl.slice(prefix.length);
  if (!encoded || encoded.length > Math.ceil(MAX_SOURCE_BYTES / 3) * 4) {
    throw new Error('The source screenshot exceeds the supported image size.');
  }
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    throw new Error('The source screenshot has invalid PNG data.');
  }
  if (binary.length < 33 || binary.length > MAX_SOURCE_BYTES) {
    throw new Error('The source screenshot has invalid PNG data.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  const header = new DataView(bytes.buffer);
  if (
    !pngSignature.every((value, i) => bytes[i] === value) ||
    header.getUint32(8) !== 13 ||
    header.getUint32(12) !== 0x49484452
  ) {
    throw new Error('The source screenshot has invalid PNG data.');
  }
  const width = header.getUint32(16);
  const height = header.getUint32(20);
  if (
    !width ||
    !height ||
    width > 32_000 ||
    height > 32_000 ||
    width * height > MAX_SOURCE_PIXELS
  ) {
    throw new Error('The source screenshot exceeds the supported image dimensions.');
  }
  return new Blob([bytes], { type: 'image/png' });
}

/** Base64 works in a service worker; it needs neither FileReader nor a DOM. */
async function pngDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks: string[] = [];
  // Every non-final chunk is divisible by three, so independently encoded
  // chunks have no padding in the middle of the combined base64 payload.
  const size = 24_576;
  for (let offset = 0; offset < bytes.length; offset += size) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + size))));
  }
  return `data:image/png;base64,${chunks.join('')}`;
}

/**
 * Composite a bounded section in the extension's own service worker. Already
 * captured pixels remain exportable if the source tab closes or navigates.
 * Only one decoded viewport bitmap is held alongside the section canvas.
 */
export async function stitchCaptureSection(
  tiles: TileSpec[],
  width: number,
  height: number,
  crop: CropRect | null,
): Promise<string> {
  if (
    ![width, height].every(Number.isSafeInteger) ||
    width <= 0 ||
    height <= 0 ||
    width > 32_000 ||
    height > 16_000 ||
    width * height > 32_000_000
  ) {
    throw new Error('The image section exceeds the supported canvas dimensions.');
  }
  if (tiles.length === 0) throw new Error('No captured tiles are available for this section.');
  if (
    crop &&
    (!Object.values(crop).every(Number.isSafeInteger) ||
      crop.x < 0 ||
      crop.y < 0 ||
      crop.w <= 0 ||
      crop.h <= 0 ||
      crop.w !== width)
  ) {
    throw new Error('The screenshot crop is invalid.');
  }
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
    throw new Error('This browser does not support local background image processing.');
  }
  const canvas = new OffscreenCanvas(width, height);
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('The browser could not create the screenshot canvas.');
    for (const tile of tiles) {
      if (!Number.isSafeInteger(tile.y))
        throw new Error('The screenshot tile position is invalid.');
      const bitmap = await createImageBitmap(localPngBlob(tile.dataUrl));
      try {
        if (crop) {
          if (crop.x + crop.w > bitmap.width || crop.y + crop.h > bitmap.height) {
            throw new Error('The scrolling region extends outside its captured screenshot.');
          }
          ctx.drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, 0, tile.y, crop.w, crop.h);
        } else {
          if (bitmap.width < width)
            throw new Error('The screenshot is narrower than the image section.');
          ctx.drawImage(bitmap, 0, tile.y);
        }
      } finally {
        bitmap.close();
      }
    }
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    if (blob.type !== 'image/png' || blob.size === 0) {
      throw new Error('The browser could not export the screenshot section.');
    }
    return await pngDataUrl(blob);
  } finally {
    // Explicitly release the potentially large backing surface before the
    // session starts composing its next section, including on export failure.
    canvas.width = 0;
    canvas.height = 0;
  }
}
