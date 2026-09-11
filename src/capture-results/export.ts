import { readCapturePart, type CaptureBundle } from '../shared/capture-bundles';
import type { PdfPage } from '../editor/pdf-writer';

/** Limit each PDF page canvas independently of the whole document's length. */
export function pdfSliceHeight(width: number): number {
  return Math.max(
    1,
    Math.min(16000, Math.floor(16_000_000 / width), Math.floor((width * 281) / 194)),
  );
}

/** The input is a validated data URL from local storage, never an HTTP URL. */
export function imageBlob(dataUrl: string): Blob {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) throw new Error('Invalid local capture image.');
  const binary = atob(dataUrl.slice(prefix.length));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

/**
 * A PDF page can span section boundaries. Decode sections strictly in order,
 * closing each bitmap before loading the next. Only one section bitmap and
 * one bounded page canvas remain live; the writer retains compressed bytes.
 */
export async function* pdfPages(
  bundle: CaptureBundle,
  onProgress: (page: number, total: number) => void,
): AsyncGenerator<PdfPage> {
  const sliceHeight = pdfSliceHeight(bundle.width);
  const pageCount = Math.ceil(bundle.height / sliceHeight);
  const pt = 72 / 25.4;
  let partIndex = 0;
  let bitmap: ImageBitmap | undefined;
  const canvas = document.createElement('canvas');
  canvas.width = bundle.width;
  try {
    for (let page = 0; page < pageCount; page++) {
      const pageY = page * sliceHeight;
      const pageHeight = Math.min(sliceHeight, bundle.height - pageY);
      canvas.height = pageHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      let filled = 0;
      while (filled < pageHeight) {
        const part = bundle.parts[partIndex];
        if (!part) throw new Error('A saved capture section is missing.');
        if (!bitmap) {
          const blob = imageBlob(await readCapturePart(bundle.id, part.index));
          bitmap = await createImageBitmap(blob);
          if (bitmap.width !== part.width || bitmap.height !== part.height) {
            throw new Error('Saved image dimensions do not match the capture.');
          }
        }
        const sourceY = pageY + filled - part.y;
        const take = Math.min(part.height - sourceY, pageHeight - filled);
        if (sourceY < 0 || take <= 0)
          throw new Error('The saved capture has a gap between sections.');
        ctx.drawImage(bitmap, 0, sourceY, part.width, take, 0, filled, part.width, take);
        filled += take;
        if (sourceY + take === part.height) {
          bitmap.close();
          bitmap = undefined;
          partIndex++;
        }
      }
      onProgress(page + 1, pageCount);
      yield {
        widthPt: 210 * pt,
        heightPt: 297 * pt,
        image: {
          canvas,
          xPt: 8 * pt,
          yPt: 8 * pt,
          wPt: 194 * pt,
          hPt: ((pageHeight * 194) / bundle.width) * pt,
        },
      };
      // Keep progress visible, including when the results tab is backgrounded.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    bitmap?.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
